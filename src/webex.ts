import { createRequire } from "node:module";
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
import { createRestClient } from "./rest-client.js";
import { matchesMessageText, matchesSpaceTitle, scanPagedMatches } from "./search.js";

const require = createRequire(import.meta.url);
const Webex = require("webex-node") as {
  init: (config: {
    config?: { fedramp?: boolean };
    credentials: { access_token: string };
  }) => WebexInstance;
};

type WebexPage<T> = {
  items: T[];
  next?: () => Promise<WebexPage<T>>;
};

type WebexInstance = {
  rooms: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawSpace>>;
    get: (id: string | { id: string }) => Promise<RawSpace>;
    create: (opts: Record<string, unknown>) => Promise<RawSpace>;
    update: (room: Record<string, unknown>) => Promise<RawSpace>;
    remove: (room: string | { id: string }) => Promise<void>;
  };
  messages: {
    list: (opts: Record<string, unknown>) => Promise<WebexPage<RawMessage>>;
    get: (id: string) => Promise<RawMessage>;
    create: (opts: Record<string, unknown>) => Promise<RawMessage>;
    update: (message: Record<string, unknown>) => Promise<RawMessage>;
    remove: (message: string | { id: string }) => Promise<void>;
  };
  people: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawPerson>>;
    get: (person: string | { id: string }) => Promise<RawPerson>;
  };
  memberships: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawMembership>>;
    get: (membership: string | { id: string }) => Promise<RawMembership>;
    create: (opts: Record<string, unknown>) => Promise<RawMembership>;
    update: (membership: Record<string, unknown>) => Promise<RawMembership>;
    remove: (membership: string | { id: string }) => Promise<void>;
  };
  teams: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawTeam>>;
    get: (team: string | { id: string }) => Promise<RawTeam>;
    create: (team: Record<string, unknown>) => Promise<RawTeam>;
    update: (team: Record<string, unknown>) => Promise<RawTeam>;
  };
  teamMemberships: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawTeamMembership>>;
    get: (membership: string | { id: string }) => Promise<RawTeamMembership>;
    create: (opts: Record<string, unknown>) => Promise<RawTeamMembership>;
    update: (membership: Record<string, unknown>) => Promise<RawTeamMembership>;
    remove: (membership: string | { id: string }) => Promise<void>;
  };
  webhooks: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawWebhook>>;
    get: (webhook: string | { id: string }) => Promise<RawWebhook>;
    create: (webhook: Record<string, unknown>) => Promise<RawWebhook>;
    update: (webhook: Record<string, unknown>) => Promise<RawWebhook>;
    remove: (webhook: string | { id: string }) => Promise<void>;
  };
  attachmentActions: {
    create: (action: Record<string, unknown>) => Promise<RawAttachmentAction>;
    get: (action: string | { id: string }) => Promise<RawAttachmentAction>;
  };
};

export type WebexOpts = {
  token: string;
  fedramp?: boolean;
  getToken?: () => Promise<string>;
};

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

  function initWebex(accessToken: string): WebexInstance {
    const initConfig: {
      config?: { fedramp: boolean };
      credentials: { access_token: string };
    } = {
      credentials: { access_token: accessToken },
    };

    if (opts.fedramp) {
      initConfig.config = { fedramp: true };
    }

    return Webex.init(initConfig);
  }

  let webex = initWebex(currentToken);

  const restOpts: {
    getAccessToken: () => string;
    fedramp?: boolean;
    refreshToken?: () => Promise<string>;
  } = { getAccessToken: () => currentToken };
  if (opts.fedramp !== undefined) restOpts.fedramp = opts.fedramp;
  if (opts.getToken) restOpts.refreshToken = opts.getToken;
  const rest = createRestClient(restOpts);

  async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!opts.getToken || !isAuthError(err)) {
        throw err;
      }

      currentToken = await opts.getToken();
      webex = initWebex(currentToken);
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
      const listOpts: Record<string, unknown> = {};
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

      const page = await webex.rooms.list(listOpts);
      const spaces = page.items.map((s) => normalizeSpace(s));

      return { total: spaces.length, spaces };
    });
  }

  async function getSpace(roomId: string) {
    return withAuthRetry(async () => {
      const space = await webex.rooms.get(roomId);
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

      const space = await webex.rooms.update(body);
      return normalizeSpace(space);
    });
  }

  async function deleteSpace(roomId: string) {
    return withAuthRetry(async () => {
      await webex.rooms.remove(roomId);
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
  }) {
    return withAuthRetry(async () => {
      const listOpts: Record<string, unknown> = { max: 100 };
      if (params.type) listOpts.type = params.type;
      if (params.teamId) listOpts.teamId = params.teamId;

      const { matched, scanned, hasMore } = await scanPagedMatches({
        fetchFirstPage: () => webex.rooms.list(listOpts),
        matches: (item) => matchesSpaceTitle(item, params.query),
        maxResults: params.maxResults ?? 20,
        scanLimit: params.scanLimit ?? 500,
      });

      return {
        matched: matched.length,
        scanned,
        hasMore,
        spaces: matched.map((s) => normalizeSpace(s)),
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

      const space = await webex.rooms.create(body);
      return normalizeSpace(space);
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

      const membership = await webex.memberships.create(body);
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
      const listOpts: Record<string, unknown> = { max: params.max ?? 100 };
      if (params.roomId) listOpts.roomId = params.roomId;
      if (params.personId) listOpts.personId = params.personId;
      if (params.personEmail) listOpts.personEmail = params.personEmail;

      const page = await webex.memberships.list(listOpts);
      const memberships = page.items.map((m) => normalizeMembership(m));

      return { total: memberships.length, memberships };
    });
  }

  async function getMembership(membershipId: string) {
    return withAuthRetry(async () => {
      const membership = await webex.memberships.get(membershipId);
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

      const membership = await webex.memberships.update(body);
      return normalizeMembership(membership);
    });
  }

  async function removeMembership(membershipId: string) {
    return withAuthRetry(async () => {
      await webex.memberships.remove(membershipId);
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
        const message = await webex.messages.get(params.messageId);
        return { messages: [normalizeMessage(message)] };
      }

      if (!params.roomId) {
        throw new Error("roomId is required when messageId is not provided");
      }

      const listOpts: Record<string, unknown> = {
        roomId: params.roomId,
        max: params.max ?? 50,
      };
      if (params.before) listOpts.before = params.before;
      if (params.beforeMessage) listOpts.beforeMessage = params.beforeMessage;
      if (params.mentionedPeople) listOpts.mentionedPeople = params.mentionedPeople;

      const page = await webex.messages.list(listOpts);
      const messages = page.items.map((m) => normalizeMessage(m));

      return { total: messages.length, messages };
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

      const message = await webex.messages.update(body);
      return normalizeMessage(message);
    });
  }

  async function deleteMessage(messageId: string) {
    return withAuthRetry(async () => {
      await webex.messages.remove(messageId);
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
      const listOpts: Record<string, unknown> = {
        roomId: params.roomId,
        max: 100,
      };
      if (params.before) listOpts.before = params.before;

      const { matched, scanned, hasMore } = await scanPagedMatches({
        fetchFirstPage: () => webex.messages.list(listOpts),
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
  }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = {};
      if (params.roomId) body.roomId = params.roomId;
      if (params.text) body.text = params.text;
      if (params.markdown) body.markdown = params.markdown;
      if (params.toPersonEmail) body.toPersonEmail = params.toPersonEmail;
      if (params.toPersonId) body.toPersonId = params.toPersonId;
      if (params.parentId) body.parentId = params.parentId;

      const message = await webex.messages.create(body);
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

      const action = await webex.attachmentActions.create(body);
      return normalizeAttachmentAction(action);
    });
  }

  async function getAttachmentAction(actionId: string) {
    return withAuthRetry(async () => {
      const action = await webex.attachmentActions.get(actionId);
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
      const listOpts: Record<string, unknown> = { max: params.max ?? 100 };
      if (params.email) listOpts.email = params.email;
      if (params.displayName) listOpts.displayName = params.displayName;
      if (params.id) listOpts.id = params.id;

      const page = await webex.people.list(listOpts);
      const people = page.items.map((p) => normalizePerson(p));

      return { total: people.length, people };
    });
  }

  async function getPerson(personId: string) {
    return withAuthRetry(async () => {
      const person = await webex.people.get(personId);
      return normalizePerson(person);
    });
  }

  async function listTeams(params: { max?: number }) {
    return withAuthRetry(async () => {
      const page = await webex.teams.list({ max: params.max ?? 100 });
      const teams = page.items.map((t) => normalizeTeam(t));
      return { total: teams.length, teams };
    });
  }

  async function createTeam(params: { name: string; description?: string }) {
    return withAuthRetry(async () => {
      const body: Record<string, unknown> = { name: params.name };
      if (params.description) body.description = params.description;

      const team = await webex.teams.create(body);
      return normalizeTeam(team);
    });
  }

  async function getTeam(teamId: string) {
    return withAuthRetry(async () => {
      const team = await webex.teams.get(teamId);
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

      const team = await webex.teams.update(body);
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
      const listOpts: Record<string, unknown> = { max: params.max ?? 100 };
      if (params.teamId) listOpts.teamId = params.teamId;
      if (params.personId) listOpts.personId = params.personId;
      if (params.personEmail) listOpts.personEmail = params.personEmail;

      const page = await webex.teamMemberships.list(listOpts);
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

      const membership = await webex.teamMemberships.create(body);
      return normalizeTeamMembership(membership);
    });
  }

  async function getTeamMembership(membershipId: string) {
    return withAuthRetry(async () => {
      const membership = await webex.teamMemberships.get(membershipId);
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

      const membership = await webex.teamMemberships.update(body);
      return normalizeTeamMembership(membership);
    });
  }

  async function removeTeamMembership(membershipId: string) {
    return withAuthRetry(async () => {
      await webex.teamMemberships.remove(membershipId);
      return { deleted: true, membershipId };
    });
  }

  async function listWebhooks(params: { max?: number }) {
    return withAuthRetry(async () => {
      const page = await webex.webhooks.list({ max: params.max ?? 100 });
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

      const webhook = await webex.webhooks.create(body);
      return normalizeWebhook(webhook);
    });
  }

  async function getWebhook(webhookId: string) {
    return withAuthRetry(async () => {
      const webhook = await webex.webhooks.get(webhookId);
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

      const webhook = await webex.webhooks.update(body);
      return normalizeWebhook(webhook);
    });
  }

  async function deleteWebhook(webhookId: string) {
    return withAuthRetry(async () => {
      await webex.webhooks.remove(webhookId);
      return { deleted: true, webhookId };
    });
  }

  return {
    listSpaces,
    getSpace,
    updateSpace,
    deleteSpace,
    getSpaceMeetingInfo,
    searchSpaces,
    createSpace,
    addMembership,
    listMemberships,
    getMembership,
    updateMembership,
    removeMembership,
    getMessages,
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
  };
}

export type WebexClient = ReturnType<typeof createWebexClient>;
