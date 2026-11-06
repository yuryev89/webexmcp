import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { searchAcrossSpaces } from "../src/cross-space-search.js";

type SearchClient = Parameters<typeof searchAcrossSpaces>[0];

function fakeClient(
  listSpaces: SearchClient["listSpaces"],
  searchMessages: SearchClient["searchMessages"],
): SearchClient {
  return { listSpaces, searchMessages };
}

describe("cross-space message search", () => {
  it("searches deduplicated explicit rooms and sorts results across spaces", async () => {
    const visited: string[] = [];
    const client = fakeClient(
      async () => { throw new Error("should not discover rooms"); },
      (async ({ roomId }) => {
        visited.push(roomId);
        const messages = roomId === "a"
          ? [{ id: "1", roomId, text: "hello world", created: "2026-01-01T00:00:00Z" }]
          : [{ id: "2", roomId, markdown: "hello again", created: "2026-01-03T00:00:00Z" }];
        return { scanned: 9, matched: 1, hasMore: false, messages };
      }) as SearchClient["searchMessages"],
    );

    const result = await searchAcrossSpaces(client, {
      query: "hello", roomIds: ["a", "b", "a"], maxResults: 2,
    });
    assert.deepEqual(visited.sort(), ["a", "b"]);
    assert.equal(result.scope, "specified-spaces");
    assert.deepEqual(result.messages.map((m) => m.id), ["2", "1"]);
    assert.equal(result.partial, false);
    assert.equal(result.scannedMessages, 18);
    assert.equal(result.messages[0]?.snippet, "hello again");
  });

  it("limits automatic discovery to recent rooms and marks result partial", async () => {
    let discoveredMax = 0;
    const seen: string[] = [];
    const client = fakeClient(
      (async (params: { max: number }) => {
        discoveredMax = params.max;
        return { total: 2, spaces: [{ id: "a" }, { id: "b" }] };
      }) as SearchClient["listSpaces"],
      (async ({ roomId }) => {
        seen.push(roomId);
        return { scanned: 2, matched: 0, hasMore: false, messages: [] };
      }) as SearchClient["searchMessages"],
    );

    const result = await searchAcrossSpaces(client, { query: "deploy", maxSpaces: 2 });
    assert.equal(discoveredMax, 2);
    assert.deepEqual(seen.sort(), ["a", "b"]);
    assert.equal(result.scope, "recent-spaces");
    assert.equal(result.partial, true);
  });

  it("reports inaccessible rooms without suppressing other results", async () => {
    const client = fakeClient(
      async () => { throw new Error("should not discover rooms"); },
      (async ({ roomId }) => {
        if (roomId === "denied") throw new Error("403 Forbidden");
        return { scanned: 5, matched: 1, hasMore: true,
          messages: [{ id: "ok", roomId, text: "deployment complete" }] };
      }) as SearchClient["searchMessages"],
    );

    const result = await searchAcrossSpaces(client, {
      query: "deployment", roomIds: ["denied", "allowed"],
    });
    assert.equal(result.searchedSpaces, 1);
    assert.equal(result.failedSpaces, 1);
    assert.equal(result.messages[0]?.id, "ok");
    assert.equal(result.partial, true);
    assert.equal(result.errors?.[0]?.roomId, "denied");
  });

  it("rejects empty queries before any API request", async () => {
    const client = fakeClient(
      async () => { throw new Error("unexpected"); },
      (async () => { throw new Error("unexpected"); }) as SearchClient["searchMessages"],
    );
    await assert.rejects(() => searchAcrossSpaces(client, {
      query: "  ", roomIds: ["a"],
    }), /query must not be empty/);
  });

  it("never exceeds configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const client = fakeClient(
      async () => { throw new Error("unexpected"); },
      (async ({ roomId }) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return { scanned: 1, matched: 1, hasMore: false,
          messages: [{ id: roomId, roomId, text: "hello" }] };
      }) as SearchClient["searchMessages"],
    );
    const result = await searchAcrossSpaces(client, {
      query: "hello", roomIds: ["1", "2", "3", "4", "5"], concurrency: 2,
    });
    assert.equal(result.messages.length, 5);
    assert.equal(peak, 2);
  });

  it("truncates long snippets but keeps match position", async () => {
    const client = fakeClient(
      async () => { throw new Error("unexpected"); },
      (async ({ roomId }) => ({
        scanned: 1, matched: 1, hasMore: false,
        messages: [{ id: "x", roomId, text: "start ".repeat(50) + "needle" + " end".repeat(50) }],
      })) as SearchClient["searchMessages"],
    );
    const result = await searchAcrossSpaces(client, {
      query: "needle", roomIds: ["r"], maxSnippetChars: 100,
    });
    assert.match(result.messages[0]!.snippet, /needle/);
    assert.equal(result.messages[0]?.snippetTruncated, true);
  });
});
