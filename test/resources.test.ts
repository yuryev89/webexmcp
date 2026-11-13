import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { createWebexApi } from "../src/resources.js";
import { createRestClient } from "../src/rest-client.js";
import { createWebexClient } from "../src/webex.js";

type Call = { method: string; url: string; body?: string };

const table = {
  rooms: ["/rooms", ["list", "get", "create", "update", "remove"]],
  memberships: ["/memberships", ["list", "get", "create", "update", "remove"]],
  messages: ["/messages", ["list", "get", "create", "update", "remove"]],
  people: ["/people", ["list", "get"]],
  teams: ["/teams", ["list", "get", "create", "update"]],
  teamMemberships: ["/team/memberships", ["list", "get", "create", "update", "remove"]],
  webhooks: ["/webhooks", ["list", "get", "create", "update", "remove"]],
  attachmentActions: ["/attachment/actions", ["get", "create"]],
} as const;

const expected: Record<string, [string, string]> = {
  list: ["GET", "?max=5"],
  get: ["GET", "/id-1"],
  create: ["POST", ""],
  update: ["PUT", "/id-1"],
  remove: ["DELETE", "/id-1"],
};

describe("webex api resources", () => {
  let calls: Call[];
  let respond: (call: Call) => Response;

  before(() => {
    mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
      const call: Call = { method: init?.method ?? "GET", url: String(url) };
      if (typeof init?.body === "string") call.body = init.body;
      calls.push(call);
      return respond(call);
    });
  });

  beforeEach(() => {
    calls = [];
    respond = (call) =>
      call.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json(call.url.includes("?") ? { items: [] } : { id: "id-1" });
  });

  after(() => {
    mock.restoreAll();
  });

  const api = createWebexApi(createRestClient({ getAccessToken: () => "t" }));

  for (const [member, [path, methods]] of Object.entries(table)) {
    for (const name of methods) {
      it(`${member}.${name} calls ${expected[name]![0]} ${path}`, async () => {
        const resource = (api as unknown as Record<string, Record<string, (arg: unknown) => Promise<unknown>>>)[member]!;
        const arg = name === "list" ? { max: 5 } : name === "create" ? { a: 1 } : name === "update" ? { id: "id-1", a: 1 } : "id-1";
        await resource[name]!(arg);
        const [method, suffix] = expected[name]!;
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.method, method);
        assert.equal(calls[0]!.url, `https://webexapis.com/v1${path}${suffix}`);
      });
    }
  }

  it("update sends PUT to /rooms/{id} without id in body", async () => {
    await api.rooms.update({ id: "r 1", title: "T" });
    assert.equal(calls[0]!.method, "PUT");
    assert.ok(calls[0]!.url.endsWith("/rooms/r%201"));
    assert.deepEqual(JSON.parse(calls[0]!.body!), { title: "T" });
  });

  it("remove resolves on 204", async () => {
    assert.deepEqual(await api.messages.remove("m-1"), { deleted: true });
  });

  it("list returns items and a next page from the Link header", async () => {
    const nextUrl = "https://webexapis.com/v1/rooms?cursor=abc";
    respond = (call) =>
      call.url === nextUrl
        ? Response.json({ items: [{ id: "b" }] })
        : Response.json({ items: [{ id: "a" }] }, { headers: { link: `<${nextUrl}>; rel="next"` } });
    const page = await api.rooms.list({ max: 1 });
    assert.deepEqual(page.items, [{ id: "a" }]);
    const second = await page.next!();
    assert.deepEqual(second.items, [{ id: "b" }]);
    assert.equal(second.next, undefined);
  });

  // Review Focus 4
  it("webex client refreshes the token once on a 401 from the REST layer", async () => {
    let refreshes = 0;
    respond = (call) =>
      calls.filter((c) => c.url === call.url).length === 1
        ? Response.json({ message: "The request requires a valid access token" }, { status: 401 })
        : Response.json({ id: "room-1", title: "Room" });
    const client = createWebexClient({
      token: "old",
      getToken: async () => {
        refreshes += 1;
        return "new";
      },
    });
    const space = await client.getSpace("room-1");
    assert.equal(space.id, "room-1");
    assert.equal(refreshes, 1);
    assert.equal(calls.length, 2);
  });

  it("webex client surfaces the Webex error message", async () => {
    respond = () => Response.json({ message: "Room not found" }, { status: 404 });
    const client = createWebexClient({ token: "t" });
    await assert.rejects(() => client.getSpace("missing"), /^Error: Room not found$|Room not found/);
  });
});
