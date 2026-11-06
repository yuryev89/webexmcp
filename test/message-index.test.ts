import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createMessageIndex, type MessageIndexClient } from "../src/message-index.js";

type Message = { id: string; roomId: string; text: string; created: string };
const created = "2026-11-01T12:00:00Z";

function mockClient(
  messages: () => Message[],
  accessible = (_roomId: string) => true,
  canReadMessage = (_messageId: string) => true,
): MessageIndexClient {
  return {
    getPerson: async () => ({ id: "test-account" }),
    getSpace: async (roomId: string) => {
      if (!accessible(roomId)) throw new Error("403 Forbidden");
      return { id: roomId };
    },
    getMessages: async ({ roomId, max, beforeMessage, messageId }) => {
      if (messageId) {
        const found = messages().filter((m) => m.id === messageId && canReadMessage(m.id));
        return { messages: found };
      }
      const list = messages().filter((m) => m.roomId === roomId);
      const pos = beforeMessage ? list.findIndex((m) => m.id === beforeMessage) + 1 : 0;
      return { total: list.slice(pos, pos + (max ?? 50)).length,
        messages: list.slice(pos, pos + (max ?? 50)) };
    },
  } as unknown as MessageIndexClient;
}

describe("local SQLite FTS5 message index", () => {
  const dirs: string[] = [];
  async function testDir() {
    const dir = await mkdtemp(join(tmpdir(), "webex-fts5-"));
    dirs.push(dir);
    return dir;
  }
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("indexes selected spaces and searches by FTS5 phrase", async () => {
    const client = mockClient(() => [
      { id: "one", roomId: "a", text: "deployment success", created },
      { id: "two", roomId: "b", text: "weekly roadmap", created },
    ]);
    const index = createMessageIndex(client, { baseDir: await testDir() });
    const sync = await index.sync({ roomIds: ["a", "b"] });
    assert.equal(sync.failedSpaces, 0);
    assert.equal(sync.rooms.length, 2);
    assert.equal((await index.status()).messages, 2);
    const result = await index.search({ query: "deployment" });
    assert.equal(result.returned, 1);
    assert.equal(result.messages[0]?.id, "one");
    assert.match(result.messages[0]!.snippet, /deployment/i);
    const restricted = await index.search({ query: "deployment", roomIds: ["b"] });
    assert.equal(restricted.returned, 0);
  });

  it("replace prunes removed/older messages and purge clears the cache", async () => {
    let messages: Message[] = [
      { id: "old", roomId: "a", text: "obsolete", created },
    ];
    const index = createMessageIndex(mockClient(() => messages),
      { baseDir: await testDir() });
    await index.sync({ roomIds: ["a"] });
    messages = [{ id: "new", roomId: "a", text: "current", created }];
    await index.sync({ roomIds: ["a"], mode: "replace" });
    assert.equal((await index.search({ query: "obsolete" })).returned, 0);
    assert.equal((await index.search({ query: "current" })).returned, 1);
    assert.deepEqual(await index.purge({ roomIds: ["a"] }), { deleted: 1, remaining: 0 });
  });

  it("incremental sync appends newer messages and avoids re-reading older pages", async () => {
    let messages: Message[] = [
      { id: "old", roomId: "a", text: "previous", created },
    ];
    const index = createMessageIndex(mockClient(() => messages),
      { baseDir: await testDir() });
    await index.sync({ roomIds: ["a"] });
    messages = [
      { id: "new", roomId: "a", text: "fresh", created: "2026-11-02T12:00:00Z" },
      ...messages,
    ];
    const result = await index.sync({ roomIds: ["a"], mode: "incremental" });
    assert.equal(result.rooms[0]?.fetched, 1);
    assert.equal((await index.status()).messages, 2);
  });

  it("refuses to return stale content from inaccessible spaces", async () => {
    let canRead = true;
    const index = createMessageIndex(mockClient(
      () => [{ id: "secret", roomId: "a", text: "confidential discussion", created }],
      () => canRead,
    ), { baseDir: await testDir() });
    await index.sync({ roomIds: ["a"] });
    canRead = false;
    const result = await index.search({ query: "confidential" });
    assert.equal(result.returned, 0);
    assert.deepEqual(result.excludedSpaces, ["a"]);
    assert.equal(result.partial, true);
  });

  it("excludes cached messages when historical message access is lost", async () => {
    let readable = true;
    const client = mockClient(
      () => [{ id: "private", roomId: "a", text: "sensitive", created }],
      () => true,
      () => readable,
    );
    const index = createMessageIndex(client, { baseDir: await testDir() });
    await index.sync({ roomIds: ["a"] });
    readable = false;
    const result = await index.search({ query: "sensitive" });
    assert.equal(result.returned, 0);
    assert.equal(result.staleMessages, 1);
    assert.equal(result.partial, true);
  });

  it("does not index an unauthorized space", async () => {
    const index = createMessageIndex(mockClient(
      () => [{ id: "x", roomId: "a", text: "private", created }],
      () => false,
    ), { baseDir: await testDir() });
    const result = await index.sync({ roomIds: ["a"] });
    assert.equal(result.failedSpaces, 1);
    assert.equal((await index.status()).messages, 0);
  });

  it("rejects empty query and missing room selection", async () => {
    const index = createMessageIndex(mockClient(() => []),
      { baseDir: await testDir() });
    await assert.rejects(() => index.sync({ roomIds: [] }), /roomIds/);
    await assert.rejects(() => index.search({ query: "   " }), /query/);
  });
});
