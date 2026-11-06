import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, describe, it, mock } from "node:test";
import { createWebexClient } from "../src/webex.js";
import { presentMessage, presentMessages } from "../src/message-output.js";

const Webex = createRequire(import.meta.url)("webex-node");

describe("compact message output", () => {
  const message = {
    id: "m1", roomId: "r1", personEmail: "a@example.com",
    created: "2026-01-01T00:00:00Z", text: "abcdefgh",
    markdown: "**abcdefgh**", parentId: "root",
    files: ["https://example.com/long-token?secret=yes"],
  };

  it("preserves the original in full mode", () => {
    assert.deepEqual(presentMessage(message, "full"), message);
    assert.deepEqual(presentMessages({ total: 1, messages: [message] }, "full"), {
      total: 1, messages: [message],
    });
  });

  it("removes duplicate markdown/URLs and marks truncated text", () => {
    const compact = presentMessage(message, "compact", 4);
    assert.deepEqual(compact, {
      id: "m1", roomId: "r1", personEmail: "a@example.com",
      created: "2026-01-01T00:00:00Z", parentId: "root",
      text: "abcd", textTruncated: true, originalChars: 8, fileCount: 1,
    });
    const collection = presentMessages({ total: 1, messages: [message] }, "compact", 4);
    assert.equal(collection.total, 1);
    assert.equal(collection.messages.length, 1);
  });

  it("falls back to markdown when plain text is unavailable", () => {
    const compact = presentMessage({ id: "m2", markdown: "**hi**" }, "compact");
    assert.equal(compact.text, "**hi**");
  });
});

describe("Webex thread context", () => {
  afterEach(() => mock.restoreAll());

  it("resolves a reply to its root and reads multiple reply pages", async () => {
    const listed: Record<string, unknown>[] = [];
    mock.method(Webex, "init", () => ({ messages: {
      get: async (id: string) => id === "child"
        ? { id: "child", roomId: "r1", parentId: "root", text: "reply" }
        : { id: "root", roomId: "r1", text: "question" },
      list: async (opts: Record<string, unknown>) => {
        listed.push(opts);
        return {
          items: [{ id: "a", parentId: "root", roomId: "r1", text: "one" }],
          next: async () => ({ items: [
            { id: "b", parentId: "root", roomId: "r1", text: "two" },
            { id: "c", parentId: "root", roomId: "r1", text: "three" },
          ] }),
        };
      },
    } }));
    const client = createWebexClient({ token: "test" });
    const result = await client.getThreadContext({ roomId: "r1", messageId: "child", maxReplies: 2 });
    assert.equal(result.root.id, "root");
    assert.deepEqual(result.replies.map((r) => r.id), ["a", "b"]);
    assert.equal(result.hasMore, true);
    assert.equal(listed[0]?.parentId, "root");
  });

  it("refuses to mix messages from different rooms", async () => {
    mock.method(Webex, "init", () => ({ messages: {
      get: async () => ({ id: "m1", roomId: "other", text: "private" }),
    } }));
    const client = createWebexClient({ token: "test" });
    await assert.rejects(
      () => client.getThreadContext({ roomId: "r1", messageId: "m1" }),
      /different space/
    );
  });
});
