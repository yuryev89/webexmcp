import type {
  RawAttachmentAction,
  RawMembership,
  RawMessage,
  RawPerson,
  RawSpace,
  RawTeam,
  RawTeamMembership,
  RawWebhook,
} from "./normalize.js";
import type { Page, Query, RestClient } from "./rest-client.js";

type Ref = string | { id: string };

/** CRUD over one Webex REST collection, shaped like a Webex SDK plugin. */
export type Resource<T> = {
  list: (query?: Query) => Promise<Page<T>>;
  get: (ref: Ref) => Promise<T>;
  create: (body: Record<string, unknown>) => Promise<T>;
  /** PUT `<path>/<body.id>` with the remaining fields. */
  update: (body: Record<string, unknown>) => Promise<T>;
  remove: (ref: Ref) => Promise<{ deleted: boolean }>;
};

function idOf(ref: Ref): string {
  return encodeURIComponent(typeof ref === "string" ? ref : ref.id);
}

function resource<T>(rest: RestClient, path: string): Resource<T> {
  return {
    list: (query) => rest.list<T>(path, query),
    get: (ref) => rest.request<T>("GET", `${path}/${idOf(ref)}`),
    create: (body) => rest.request<T>("POST", path, { body }),
    update: ({ id, ...body }) => rest.request<T>("PUT", `${path}/${idOf(String(id))}`, { body }),
    remove: (ref) => rest.request<{ deleted: boolean }>("DELETE", `${path}/${idOf(ref)}`),
  };
}

export function createWebexApi(rest: RestClient) {
  const people = resource<RawPerson>(rest, "/people");
  const teams = resource<RawTeam>(rest, "/teams");
  const attachmentActions = resource<RawAttachmentAction>(rest, "/attachment/actions");
  return {
    rooms: resource<RawSpace>(rest, "/rooms"),
    memberships: resource<RawMembership>(rest, "/memberships"),
    messages: resource<RawMessage>(rest, "/messages"),
    people: { list: people.list, get: people.get },
    teams: { list: teams.list, get: teams.get, create: teams.create, update: teams.update },
    teamMemberships: resource<RawTeamMembership>(rest, "/team/memberships"),
    webhooks: resource<RawWebhook>(rest, "/webhooks"),
    attachmentActions: { get: attachmentActions.get, create: attachmentActions.create },
  };
}

export type WebexApi = ReturnType<typeof createWebexApi>;
