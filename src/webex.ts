import { createRequire } from "node:module";
import {
  normalizeMembership,
  normalizeMessage,
  normalizePerson,
  normalizeSpace,
  type RawMembership,
  type RawMessage,
  type RawPerson,
  type RawSpace,
} from "./normalize.js";
import { matchesMessageText, matchesSpaceTitle, scanPagedMatches } from "./search.js";

const require = createRequire(import.meta.url);
const Webex = require("webex-node") as {
  init: (config: {
    config?: { fedramp?: boolean };
    credentials: { access_token: string };
  }) => WebexInstance;
};

type WebexInstance = {
  rooms: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawSpace>>;
    create: (opts: Record<string, unknown>) => Promise<RawSpace>;
  };
  messages: {
    list: (opts: Record<string, unknown>) => Promise<WebexPage<RawMessage>>;
    get: (id: string) => Promise<RawMessage>;
    create: (opts: Record<string, unknown>) => Promise<RawMessage>;
  };
  people: {
    list: (opts?: Record<string, unknown>) => Promise<WebexPage<RawPerson>>;
  };
  memberships: {
    create: (opts: Record<string, unknown>) => Promise<RawMembership>;
  };
};

type WebexPage<T> = {
  items: T[];
  next?: () => Promise<WebexPage<T>>;
};

export type WebexOpts = {
  token: string;
  fedramp?: boolean;
};

export function createWebexClient(opts: WebexOpts) {
  const initConfig: {
    config?: { fedramp: boolean };
    credentials: { access_token: string };
  } = {
    credentials: { access_token: opts.token },
  };

  if (opts.fedramp) {
    initConfig.config = { fedramp: true };
  }

  const webex = Webex.init(initConfig);

  async function listSpaces(params: {
    type?: "group" | "direct";
    teamId?: string;
    max?: number;
    sortBy?: string;
  }) {
    const listOpts: Record<string, unknown> = {};
    if (params.type) listOpts.type = params.type;
    if (params.teamId) listOpts.teamId = params.teamId;
    if (params.sortBy) listOpts.sortBy = params.sortBy;
    listOpts.max = params.max ?? 100;

    const page = await webex.rooms.list(listOpts);
    const spaces = page.items.map((s) => normalizeSpace(s));

    return { total: spaces.length, spaces };
  }

  async function searchSpaces(params: {
    query: string;
    type?: "group" | "direct";
    teamId?: string;
    maxResults?: number;
    scanLimit?: number;
  }) {
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
  }

  async function createSpace(params: {
    title: string;
    teamId?: string;
    description?: string;
    isLocked?: boolean;
    isPublic?: boolean;
    isAnnouncementOnly?: boolean;
  }) {
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
  }

  async function addMembership(params: {
    roomId: string;
    personEmail?: string;
    personId?: string;
    isModerator?: boolean;
  }) {
    const body: Record<string, unknown> = {
      roomId: params.roomId,
      isModerator: params.isModerator ?? false,
    };
    if (params.personId) body.personId = params.personId;
    else if (params.personEmail) body.personEmail = params.personEmail;

    const membership = await webex.memberships.create(body);
    return normalizeMembership(membership);
  }

  async function getMessages(params: {
    roomId?: string;
    messageId?: string;
    before?: string;
    beforeMessage?: string;
    mentionedPeople?: string;
    max?: number;
  }) {
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
  }

  async function searchMessages(params: {
    roomId: string;
    query: string;
    maxResults?: number;
    scanLimit?: number;
    before?: string;
  }) {
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
  }

  async function getPeople(params: {
    email?: string;
    displayName?: string;
    id?: string;
    max?: number;
  }) {
    const listOpts: Record<string, unknown> = { max: params.max ?? 100 };
    if (params.email) listOpts.email = params.email;
    if (params.displayName) listOpts.displayName = params.displayName;
    if (params.id) listOpts.id = params.id;

    const page = await webex.people.list(listOpts);
    const people = page.items.map((p) => normalizePerson(p));

    return { total: people.length, people };
  }

  async function createMessage(params: {
    roomId?: string;
    text?: string;
    markdown?: string;
    toPersonEmail?: string;
    toPersonId?: string;
    parentId?: string;
  }) {
    const body: Record<string, unknown> = {};
    if (params.roomId) body.roomId = params.roomId;
    if (params.text) body.text = params.text;
    if (params.markdown) body.markdown = params.markdown;
    if (params.toPersonEmail) body.toPersonEmail = params.toPersonEmail;
    if (params.toPersonId) body.toPersonId = params.toPersonId;
    if (params.parentId) body.parentId = params.parentId;

    const message = await webex.messages.create(body);
    return normalizeMessage(message);
  }

  return {
    listSpaces,
    searchSpaces,
    createSpace,
    addMembership,
    getMessages,
    searchMessages,
    getPeople,
    createMessage,
  };
}

export type WebexClient = ReturnType<typeof createWebexClient>;
