import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { readSpacesCacheConfig, resolveDownloadDir } from "./auth/config.js";
import {
  classifyFile,
  messageUuidFromContentsUrl,
  sanitizeFilename,
  uniqueFilename,
  uuidFromMessageId,
} from "./file-content.js";
import {
  normalizeAttachmentAction,
  normalizeMembership,
  normalizeMessage,
  normalizePerson,
  normalizeSpace,
  normalizeTeam,
  normalizeTeamMembership,
  normalizeWebhook,
  type RawAttachmentAction,
  type RawMembership,
  type RawMessage,
  type RawPerson,
  type RawSpace,
  type RawTeam,
  type RawTeamMembership,
  type RawWebhook,
} from "./normalize.js";
import { createWebexApi } from "./resources.js";
import { createRestClient, type Query } from "./rest-client.js";
import { matchesMessageText, matchesSpaceTitle, scanPagedMatches } from "./search.js";
import {
  createEmptyCacheRecord,
  isCacheExpired,
  mergeCachedSpaces,
  type CachedSpace,
  type SpacesCacheRecord,
  removeCachedSpace,
  replaceCachedSpaces,
  searchCachedSpaces,
  SpacesCacheStore,
  upsertCachedSpaces,
} from "./spaces-cache.js";

export type WebexOpts = {
  token: string;
  fedramp?: boolean;
  getToken?: () => Promise<string>;
};

const FILE_DETAILS_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

function toCachedSpace(space: ReturnType<typeof normalizeSpace>): CachedSpace | null {
  if (!space.id) {
    return null;
  }
  return space as CachedSpace;
}

function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  const error = err as {
    statusCode?: number;
    status?: number;
    message?: string;
    body?: { message?: string };
  };

  const status = error.statusCode ?? error.status;
  if (status === 401) {
    return true;
  }

  const message = `${error.message ?? ""} ${error.body?.message ?? ""}`.toLowerCase();
  return message.includes("401") || message.includes("invalid token");
}

export function createWebexClient(opts: WebexOpts) {
  let currentToken = opts.token;
  const spacesCacheConfig = readSpacesCacheConfig();
  const spacesCacheStore = spacesCacheConfig.enabled
    ? new SpacesCacheStore(spacesCacheConfig.cachePath, spacesCacheConfig.ttlMs)
    : null;
  let syncInFlight: Promise<unknown> | null = null;

  const restOpts: {
    getAccessToken: () => string;
    fedramp?: boolean;
    refreshToken?: () => Promise<string>;
  } = { getAccessToken: () => currentToken };
  if (opts.fedramp !== undefined) restOpts.fedramp = opts.fedramp;
  const getToken = opts.getToken;
  if (getToken) {
    restOpts.refreshToken = async () => (currentToken = await getToken());
  }
  const rest = createRestClient(restOpts);
  const api = createWebexApi(rest);

  async function loadSpacesCache(): Promise<SpacesCacheRecord> {
    if (!spacesCacheStore) {
      return createEmptyCacheRecord(spacesCacheConfig.ttlMs);
    }
    return spacesCacheStore.load();
  }

  async function saveSpacesCache(record: SpacesCacheRecord): Promise<void> {
    if (!spacesCacheStore) {
      return;
    }
    await spacesCacheStore.save(record);
  }

  async function cacheSpaceMutation(
    mutate: (record: SpacesCacheRecord) => SpacesCacheRecord
  ): Promise<void> {
    if (!spacesCacheStore) {
      return;
    }
    const record = await loadSpacesCache();
    await saveSpacesCache(mutate(record));
  }

  async function fetchAllSpacesForCache(maxSpaces: number): Promise<{
    spaces: CachedSpace[];
    complete: boolean;
  }> {
    const spaces: CachedSpace[] = [];
    let complete = false;
    let page = await api.rooms.list({ max: 100, sortBy: "lastactivity" });

    while (true) {
      for (const item of page.items) {
        const cached = toCachedSpace(normalizeSpace(item));
        if (cached) {
          spaces.push(cached);
        }
        if (spaces.length >= maxSpaces) {
          complete = false;
          return { spaces, complete };
        }
      }

      if (!page.next) {
        complete = true;
        break;
      }

      page = await page.next();
    }

    return { spaces, complete };
  }

  async function syncSpacesCache(params?: { maxSpaces?: number }) {
    return withAuthRetry(async () => {
      const maxSpaces = params?.maxSpaces ?? spacesCacheConfig.maxSpaces;
      const { spaces, complete } = await fetchAllSpacesForCache(maxSpaces);
      const record = replaceCachedSpaces(await loadSpacesCache(), spaces, complete);
      await saveSpacesCache(record);

      return {
        synced: spaces.length,
        complete,
        syncedAt: record.syncedAt,
        cachePath: spacesCacheConfig.cachePath,
      };
    });
  }

  function scheduleSpacesCacheSync(): void {
    if (!spacesCacheStore || syncInFlight) {
      return;
    }

    syncInFlight = syncSpacesCache()
      .catch(() => undefined)
      .finally(() => {
        syncInFlight = null;
      });
  }

  async function ensureSpacesCacheFresh(): Promise<void> {
    if (!spacesCacheStore) {
      return;
    }

    const record = await loadSpacesCache();
    if (!isCacheExpired(record) && record.complete) {
      return;
    }

    scheduleSpacesCacheSync();
    await syncInFlight;
  }

  async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!opts.getToken || !isAuthError(err)) {
        throw err;
      }

      currentToken = await opts.getToken();
      return fn();
    }
  }

  async function listSpaces(params: {
    type?: "group" | "direct";
    teamId?: string;
    orgPublicSpaces?: boolean;
    from?: string;
    to?: string;
    max?: number;
    sortBy?: string;
  }) {
    return withAuthRetry(async () => {
      const listOpts: Query = {};
      if (params.type) {
        listOpts.type = params.type;
      } else if (params.orgPublicSpaces !== undefined) {
        listOpts.orgPublicSpaces = params.orgPublicSpaces;
      }
      if (params.teamId) listOpts.teamId = params.teamId;
      if (params.from) listOpts.from = params.from;
      if (params.to) listOpts.to = params.to;
      if (params.sortBy) listOpts.sortBy = params.sortBy;
      listOpts.max = params.max ?? 100;

      const page = await api.rooms.list(listOpts);
      const spaces = page.items.map((s) => normalizeSpace(s));

      return { total: spaces.length, spaces };
    });
  }

  async function getSpace(roomId: string) {
    return withAuthRetry(async () => {
      const space = await api.rooms.get(roomId);
      return normalizeSpace(space);
    });
  }

  async function updateSpace(params: {
    roomId: string;
    title?: string;
    description?: string;
    isLocked?: boolean;
    isPublic?: boolean;
    isAnnouncementOnly?: boolean;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { id: params.roomId };
      if (params.title !== undefined) body.title = params.title;
      if (params.description !== undefined) body.description = params.description;
      if (params.isLocked !== undefined) body.isLocked = params.isLocked;
      if (params.isPublic !== undefined) body.isPublic = params.isPublic;
      if (params.isAnnouncementOnly !== undefined) {
        body.isAnnouncementOnly = params.isAnnouncementOnly;
      }

      const space = await api.rooms.update(body);
      const normalized = normalizeSpace(space);
      const cached = toCachedSpace(normalized);
      if (cached) {
        await cacheSpaceMutation((record) => upsertCachedSpaces(record, [cached]));
      }
      return normalized;
    });
  }

  async function deleteSpace(roomId: string) {
    return withAuthRetry(async () => {
      await api.rooms.remove(roomId);
      await cacheSpaceMutation((record) => removeCachedSpace(record, roomId));
      return { deleted: true, roomId };
    });
  }

  async function getSpaceMeetingInfo(roomId: string) {
    return withAuthRetry(() => rest.getSpaceMeetingInfo(roomId));
  }

  async function searchSpaces(params: {
    query: string;
    type?: "group" | "direct";
    teamId?: string;
    maxResults?: number;
    scanLimit?: number;
    sortBy?: string;
  }) {
    return withAuthRetry(async () => {
      const maxResults = params.maxResults ?? 20;
      const scanLimit = params.scanLimit ?? 500;
      const sortBy = params.sortBy ?? "lastactivity";
      const searchParams = {
        query: params.query,
        maxResults,
        ...(params.type ? { type: params.type } : {}),
        ...(params.teamId ? { teamId: params.teamId } : {}),
      };

      let cacheRecord = await loadSpacesCache();
      const cacheFresh = !isCacheExpired(cacheRecord);
      const cacheCount = Object.keys(cacheRecord.spaces).length;

      let cacheMatches: CachedSpace[] = [];
      if (cacheFresh && cacheCount > 0) {
        cacheMatches = searchCachedSpaces(cacheRecord, searchParams);
        // Prefer cache: full index, or any hit in a partial cache. API only on cache miss.
        if (cacheRecord.complete || cacheMatches.length > 0) {
          return {
            matched: cacheMatches.length,
            scanned: cacheCount,
            hasMore: !cacheRecord.complete,
            source: "cache" as const,
            spaces: cacheMatches,
          };
        }
      }

      const listOpts: Query = { max: 100, sortBy };
      if (params.type) listOpts.type = params.type;
      if (params.teamId) listOpts.teamId = params.teamId;

      const { matched, scanned, hasMore } = await scanPagedMatches({
        fetchFirstPage: () => api.rooms.list(listOpts),
        matches: (item) => matchesSpaceTitle(item, params.query),
        maxResults,
        scanLimit,
      });

      const apiSpaces = matched.map((space) => normalizeSpace(space));
      const cachedFromApi = apiSpaces
        .map((space) => toCachedSpace(space))
        .filter((space): space is CachedSpace => space !== null);

      if (cachedFromApi.length > 0) {
        cacheRecord = upsertCachedSpaces(cacheRecord, cachedFromApi);
        await saveSpacesCache(cacheRecord);
      }

      if (!cacheFresh || !cacheRecord.complete) {
        scheduleSpacesCacheSync();
      }

      const mergedSpaces = mergeCachedSpaces(cacheMatches, cachedFromApi, maxResults);
      const source =
        cacheMatches.length > 0 && cachedFromApi.length > 0
          ? ("cache+api" as const)
          : cacheMatches.length > 0
            ? ("cache" as const)
            : ("api" as const);

      return {
        matched: mergedSpaces.length,
        scanned: cacheFresh ? cacheCount + scanned : scanned,
        hasMore,
        source,
        spaces: mergedSpaces,
      };
    });
  }

  async function createSpace(params: {
    title: string;
    teamId?: string;
    description?: string;
    isLocked?: boolean;
    isPublic?: boolean;
    isAnnouncementOnly?: boolean;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { title: params.title };
      if (params.teamId) body.teamId = params.teamId;
      if (params.description) body.description = params.description;
      if (params.isLocked !== undefined) body.isLocked = params.isLocked;
      if (params.isPublic !== undefined) body.isPublic = params.isPublic;
      if (params.isAnnouncementOnly !== undefined) {
        body.isAnnouncementOnly = params.isAnnouncementOnly;
      }

      const space = await api.rooms.create(body);
      const normalized = normalizeSpace(space);
      const cached = toCachedSpace(normalized);
      if (cached) {
        await cacheSpaceMutation((record) => upsertCachedSpaces(record, [cached]));
      }
      return normalized;
    });
  }

  async function addMembership(params: {
    roomId: string;
    personEmail?: string;
    personId?: string;
    isModerator?: boolean;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = {
        roomId: params.roomId,
        isModerator: params.isModerator ?? false,
      };
      if (params.personId) body.personId = params.personId;
      else if (params.personEmail) body.personEmail = params.personEmail;

      const membership = await api.memberships.create(body);
      return normalizeMembership(membership);
    });
  }

  async function listMemberships(params: {
    roomId?: string;
    personId?: string;
    personEmail?: string;
    max?: number;
  }) {
    return withAuthRetry(async () => {
      const listOpts: Query = { max: params.max ?? 100 };
      if (params.roomId) listOpts.roomId = params.roomId;
      if (params.personId) listOpts.personId = params.personId;
      if (params.personEmail) listOpts.personEmail = params.personEmail;

      const page = await api.memberships.list(listOpts);
      const memberships = page.items.map((m) => normalizeMembership(m));

      return { total: memberships.length, memberships };
    });
  }

  async function getMembership(membershipId: string) {
    return withAuthRetry(async () => {
      const membership = await api.memberships.get(membershipId);
      return normalizeMembership(membership);
    });
  }

  async function updateMembership(params: {
    membershipId: string;
    isModerator?: boolean;
    isMonitor?: boolean;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { id: params.membershipId };
      if (params.isModerator !== undefined) body.isModerator = params.isModerator;
      if (params.isMonitor !== undefined) body.isMonitor = params.isMonitor;

      const membership = await api.memberships.update(body);
      return normalizeMembership(membership);
    });
  }

  async function removeMembership(membershipId: string) {
    return withAuthRetry(async () => {
      await api.memberships.remove(membershipId);
      return { deleted: true, membershipId };
    });
  }

  async function getMessages(params: {
    roomId?: string;
    messageId?: string;
    before?: string;
    beforeMessage?: string;
    mentionedPeople?: string;
    max?: number;
  }) {
    return withAuthRetry(async () => {
      if (params.messageId) {
        const message = await api.messages.get(params.messageId);
        return { messages: [normalizeMessage(message)] };
      }

      if (!params.roomId) {
        throw new Error("roomId is required when messageId is not provided");
      }

      const listOpts: Query = {
        roomId: params.roomId,
        max: params.max ?? 50,
      };
      if (params.before) listOpts.before = params.before;
      if (params.beforeMessage) listOpts.beforeMessage = params.beforeMessage;
      if (params.mentionedPeople) listOpts.mentionedPeople = params.mentionedPeople;

      const page = await api.messages.list(listOpts);
      const messages = page.items.map((m) => normalizeMessage(m));

      return { total: messages.length, messages };
    });
  }

  /**
   * Resolve a message (root or reply), then fetch its thread with bounded paging.
   * Never return content from a different space than the caller specified.
   */
  async function getThreadContext(params: {
    roomId: string;
    messageId: string;
    maxReplies?: number;
  }) {
    return withAuthRetry(async () => {
      const selected = normalizeMessage(await webex.messages.get(params.messageId));
      if (selected.roomId && selected.roomId !== params.roomId) {
        throw new Error("Message belongs to a different space");
      }

      const rootId = selected.parentId ?? selected.id;
      if (!rootId) throw new Error("Message has no ID");
      const root = selected.parentId
        ? normalizeMessage(await webex.messages.get(rootId))
        : selected;
      if (root.roomId && root.roomId !== params.roomId) {
        throw new Error("Thread root belongs to a different space");
      }

      const limit = Math.max(1, Math.min(params.maxReplies ?? 100, 500));
      const replies: ReturnType<typeof normalizeMessage>[] = [];
      let page = await webex.messages.list({
        roomId: params.roomId, parentId: rootId, max: Math.min(limit, 100),
      });

      while (true) {
        for (let i = 0; i < page.items.length; i++) {
          const reply = normalizeMessage(page.items[i]!);
          if (reply.parentId !== rootId || reply.id === rootId) continue;
          replies.push(reply);
          if (replies.length >= limit) {
            return {
              roomId: params.roomId, root, replies,
              total: replies.length,
              hasMore: i < page.items.length - 1 || Boolean(page.next),
            };
          }
        }
        if (!page.next) break;
        page = await page.next();
      }

      return { roomId: params.roomId, root, replies, total: replies.length, hasMore: false };
    });
  }

  async function updateMessage(params: {
    messageId: string;
    text?: string;
    markdown?: string;
    roomId?: string;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { id: params.messageId };
      if (params.text !== undefined) body.text = params.text;
      if (params.markdown !== undefined) body.markdown = params.markdown;
      if (params.roomId !== undefined) body.roomId = params.roomId;

      const message = await api.messages.update(body);
      return normalizeMessage(message);
    });
  }

  async function deleteMessage(messageId: string) {
    return withAuthRetry(async () => {
      await api.messages.remove(messageId);
      return { deleted: true, messageId };
    });
  }

  async function listDirectMessages(params: {
    parentId?: string;
    personId?: string;
    personEmail?: string;
  }) {
    return withAuthRetry(async () => {
      const data = await rest.listDirectMessages(params);
      const items = (data.items ?? []) as RawMessage[];
      const messages = items.map((m) => normalizeMessage(m));
      return { total: messages.length, messages };
    });
  }

  async function searchMessages(params: {
    roomId: string;
    query: string;
    maxResults?: number;
    scanLimit?: number;
    before?: string;
  }) {
    return withAuthRetry(async () => {
      const listOpts: Query = {
        roomId: params.roomId,
        max: 100,
      };
      if (params.before) listOpts.before = params.before;

      const { matched, scanned, hasMore } = await scanPagedMatches({
        fetchFirstPage: () => api.messages.list(listOpts),
        matches: (item) => matchesMessageText(item, params.query),
        maxResults: params.maxResults ?? 20,
        scanLimit: params.scanLimit ?? 500,
      });

      return {
        matched: matched.length,
        scanned,
        hasMore,
        messages: matched.map((m) => normalizeMessage(m)),
      };
    });
  }

  async function createMessage(params: {
    roomId?: string;
    text?: string;
    markdown?: string;
    toPersonEmail?: string;
    toPersonId?: string;
    parentId?: string;
    files?: string[];
    filePath?: string;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = {};
      if (params.roomId) body.roomId = params.roomId;
      if (params.text) body.text = params.text;
      if (params.markdown) body.markdown = params.markdown;
      if (params.toPersonEmail) body.toPersonEmail = params.toPersonEmail;
      if (params.toPersonId) body.toPersonId = params.toPersonId;
      if (params.parentId) body.parentId = params.parentId;
      if (params.files) body.files = params.files;

      if (params.filePath) {
        const info = await stat(params.filePath);
        if (!info.isFile()) throw new Error("filePath must point to a regular file");
        if (info.size > 100 * 1024 * 1024) {
          throw new Error("File exceeds the Webex 100 MB attachment limit");
        }
        const form = new FormData();
        for (const [key, value] of Object.entries(body)) {
          if (key !== "files") form.append(key, String(value));
        }
        form.append("files", await openAsBlob(params.filePath), basename(params.filePath));
        return normalizeMessage(await rest.request<RawMessage>("POST", "/messages", { form }));
      }

      const message = await api.messages.create(body);
      return normalizeMessage(message);
    });
  }

  async function createAttachmentAction(params: {
    messageId: string;
    type: string;
    inputs?: Record<string, unknown>;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = {
        messageId: params.messageId,
        type: params.type,
      };
      if (params.inputs) body.inputs = params.inputs;

      const action = await api.attachmentActions.create(body);
      return normalizeAttachmentAction(action);
    });
  }

  async function getAttachmentAction(actionId: string) {
    return withAuthRetry(async () => {
      const action = await api.attachmentActions.get(actionId);
      return normalizeAttachmentAction(action);
    });
  }

  async function getPeople(params: {
    email?: string;
    displayName?: string;
    id?: string;
    max?: number;
  }) {
    return withAuthRetry(async () => {
      const listOpts: Query = { max: params.max ?? 100 };
      if (params.email) listOpts.email = params.email;
      if (params.displayName) listOpts.displayName = params.displayName;
      if (params.id) listOpts.id = params.id;

      const page = await api.people.list(listOpts);
      const people = page.items.map((p) => normalizePerson(p));

      return { total: people.length, people };
    });
  }

  async function getPerson(personId: string) {
    return withAuthRetry(async () => {
      const person = await api.people.get(personId);
      return normalizePerson(person);
    });
  }

  async function listTeams(params: { max?: number }) {
    return withAuthRetry(async () => {
      const page = await api.teams.list({ max: params.max ?? 100 });
      const teams = page.items.map((t) => normalizeTeam(t));
      return { total: teams.length, teams };
    });
  }

  async function createTeam(params: { name: string; description?: string }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { name: params.name };
      if (params.description) body.description = params.description;

      const team = await api.teams.create(body);
      return normalizeTeam(team);
    });
  }

  async function getTeam(teamId: string) {
    return withAuthRetry(async () => {
      const team = await api.teams.get(teamId);
      return normalizeTeam(team);
    });
  }

  async function updateTeam(params: {
    teamId: string;
    name?: string;
    description?: string;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { id: params.teamId };
      if (params.name !== undefined) body.name = params.name;
      if (params.description !== undefined) body.description = params.description;

      const team = await api.teams.update(body);
      return normalizeTeam(team);
    });
  }

  async function deleteTeam(teamId: string) {
    return withAuthRetry(() => rest.deleteTeam(teamId));
  }

  async function listTeamMemberships(params: {
    teamId?: string;
    personId?: string;
    personEmail?: string;
    max?: number;
  }) {
    return withAuthRetry(async () => {
      const listOpts: Query = { max: params.max ?? 100 };
      if (params.teamId) listOpts.teamId = params.teamId;
      if (params.personId) listOpts.personId = params.personId;
      if (params.personEmail) listOpts.personEmail = params.personEmail;

      const page = await api.teamMemberships.list(listOpts);
      const memberships = page.items.map((m) => normalizeTeamMembership(m));

      return { total: memberships.length, memberships };
    });
  }

  async function addTeamMembership(params: {
    teamId: string;
    personEmail?: string;
    personId?: string;
    isModerator?: boolean;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = {
        teamId: params.teamId,
        isModerator: params.isModerator ?? false,
      };
      if (params.personId) body.personId = params.personId;
      else if (params.personEmail) body.personEmail = params.personEmail;

      const membership = await api.teamMemberships.create(body);
      return normalizeTeamMembership(membership);
    });
  }

  async function getTeamMembership(membershipId: string) {
    return withAuthRetry(async () => {
      const membership = await api.teamMemberships.get(membershipId);
      return normalizeTeamMembership(membership);
    });
  }

  async function updateTeamMembership(params: {
    membershipId: string;
    isModerator?: boolean;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { id: params.membershipId };
      if (params.isModerator !== undefined) body.isModerator = params.isModerator;

      const membership = await api.teamMemberships.update(body);
      return normalizeTeamMembership(membership);
    });
  }

  async function removeTeamMembership(membershipId: string) {
    return withAuthRetry(async () => {
      await api.teamMemberships.remove(membershipId);
      return { deleted: true, membershipId };
    });
  }

  async function listWebhooks(params: { max?: number }) {
    return withAuthRetry(async () => {
      const page = await api.webhooks.list({ max: params.max ?? 100 });
      const webhooks = page.items.map((w) => normalizeWebhook(w));
      return { total: webhooks.length, webhooks };
    });
  }

  async function createWebhook(params: {
    name: string;
    targetUrl: string;
    resource: string;
    event: string;
    filter?: string;
    secret?: string;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = {
        name: params.name,
        targetUrl: params.targetUrl,
        resource: params.resource,
        event: params.event,
      };
      if (params.filter) body.filter = params.filter;
      if (params.secret) body.secret = params.secret;

      const webhook = await api.webhooks.create(body);
      return normalizeWebhook(webhook);
    });
  }

  async function getWebhook(webhookId: string) {
    return withAuthRetry(async () => {
      const webhook = await api.webhooks.get(webhookId);
      return normalizeWebhook(webhook);
    });
  }

  async function updateWebhook(params: {
    webhookId: string;
    name?: string;
    targetUrl?: string;
    resource?: string;
    event?: string;
    filter?: string;
    secret?: string;
    status?: string;
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { id: params.webhookId };
      if (params.name !== undefined) body.name = params.name;
      if (params.targetUrl !== undefined) body.targetUrl = params.targetUrl;
      if (params.resource !== undefined) body.resource = params.resource;
      if (params.event !== undefined) body.event = params.event;
      if (params.filter !== undefined) body.filter = params.filter;
      if (params.secret !== undefined) body.secret = params.secret;
      if (params.status !== undefined) body.status = params.status;

      const webhook = await api.webhooks.update(body);
      return normalizeWebhook(webhook);
    });
  }

  async function deleteWebhook(webhookId: string) {
    return withAuthRetry(async () => {
      await api.webhooks.remove(webhookId);
      return { deleted: true, webhookId };
    });
  }

  async function getFileDetails(fileUrl: string) {
    return withAuthRetry(() => rest.headContents(fileUrl));
  }

  async function downloadFile(fileUrl: string) {
    return withAuthRetry(() => rest.getContents(fileUrl));
  }

  /** All files of one message go to `<downloadDir>/<messageUuid>/`. */
  function attachmentFolder(fileUrl: string): string {
    const uuid =
      messageUuidFromContentsUrl(fileUrl) ??
      createHash("sha256").update(fileUrl).digest("hex").slice(0, 16);
    return join(resolveDownloadDir(), uuid);
  }

  /**
   * Save one attachment to disk. An existing file with the same name is replaced, so saving
   * again refreshes it; pass `taken` to keep distinct names within one batch instead.
   */
  async function saveFile(fileUrl: string, taken?: Set<string>) {
    const folder = attachmentFolder(fileUrl);
    const saved = await withAuthRetry(() =>
      rest.saveContents(fileUrl, (details) => {
        const name = sanitizeFilename(details.filename);
        const target = resolvePath(folder, taken ? uniqueFilename(name, taken) : name);
        if (dirname(target) !== resolvePath(folder)) {
          throw new Error("Refusing to save outside the download folder");
        }
        return target;
      })
    );
    taken?.add(basename(saved.path).toLowerCase());
    return {
      path: saved.path,
      directory: dirname(saved.path),
      filename: saved.filename,
      contentType: saved.contentType,
      kind: classifyFile(saved.contentType, saved.filename),
      size: saved.size,
      sha256: saved.sha256,
      url: saved.url,
    };
  }

  async function saveMessageFiles(messageId: string) {
    const { messages } = await getMessages({ messageId });
    const message = messages[0];
    if (!message) {
      throw new Error("Message not found");
    }
    const files = message.files ?? [];
    const taken = new Set<string>();
    const saved: Awaited<ReturnType<typeof saveFile>>[] = [];
    const failed: Array<{ fileUrl: string; error: string }> = [];
    for (const fileUrl of files) {
      try {
        saved.push(await saveFile(fileUrl, taken));
      } catch (err) {
        failed.push({ fileUrl, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const directory =
      saved[0]?.directory ??
      (files[0] ? attachmentFolder(files[0]) : undefined) ??
      join(resolveDownloadDir(), uuidFromMessageId(messageId) ?? "unknown");
    return { messageId, directory, files: files.length, saved, failed };
  }

  /**
   * Add `attachments` (filename, type, size, kind) to every message that has `files[]`,
   * so an agent can see what was shared without one call per file.
   */
  async function addFileDetails<T extends { files?: string[] | undefined }>(messages: T[]) {
    const urls = [...new Set(messages.flatMap((m) => m.files ?? []))];
    const details = new Map<string, Record<string, unknown>>();
    await runWithConcurrency(urls, FILE_DETAILS_CONCURRENCY, async (url) => {
      try {
        const info = await getFileDetails(url);
        details.set(url, { ...info, kind: classifyFile(info.contentType, info.filename) });
      } catch (err) {
        details.set(url, { url, error: err instanceof Error ? err.message : String(err) });
      }
    });
    return messages.map((m) =>
      m.files?.length ? { ...m, attachments: m.files.map((url) => details.get(url)) } : m
    );
  }

  return {
    listSpaces,
    getSpace,
    updateSpace,
    deleteSpace,
    getSpaceMeetingInfo,
    searchSpaces,
    ensureSpacesCacheFresh,
    createSpace,
    addMembership,
    listMemberships,
    getMembership,
    updateMembership,
    removeMembership,
    getMessages,
    getThreadContext,
    updateMessage,
    deleteMessage,
    listDirectMessages,
    searchMessages,
    createMessage,
    createAttachmentAction,
    getAttachmentAction,
    getPeople,
    getPerson,
    listTeams,
    createTeam,
    getTeam,
    updateTeam,
    deleteTeam,
    listTeamMemberships,
    addTeamMembership,
    getTeamMembership,
    updateTeamMembership,
    removeTeamMembership,
    listWebhooks,
    createWebhook,
    getWebhook,
    updateWebhook,
    deleteWebhook,
    getFileDetails,
    downloadFile,
    saveFile,
    saveMessageFiles,
    addFileDetails,
  };
}

export type WebexClient = ReturnType<typeof createWebexClient>;
