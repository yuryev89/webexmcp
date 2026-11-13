import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { createWebexClient } from "../src/webex.js";
import { presentMessage, presentMessages } from "../src/message-output.js";

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
    const requests: URL[] = [];
    mock.method(globalThis, "fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      requests.push(url);

      if (url.pathname === "/v1/messages/child") {
        return Response.json({ id: "child", roomId: "r1", parentId: "root", text: "reply" });
      }
      if (url.pathname === "/v1/messages/root") {
        return Response.json({ id: "root", roomId: "r1", text: "question" });
      }
      if (url.pathname === "/v1/messages" && url.searchParams.get("cursor") === "next") {
        return Response.json({ items: [
          { id: "b", parentId: "root", roomId: "r1", text: "two" },
          { id: "c", parentId: "root", roomId: "r1", text: "three" },
        ] });
      }
      if (url.pathname === "/v1/messages") {
        return Response.json({
          items: [{ id: "a", parentId: "root", roomId: "r1", text: "one" }],
        }, {
          headers: { link: '<https://webexapis.com/v1/messages?cursor=next>; rel="next"' },
        });
      }
      return Response.json({ message: "Not found" }, { status: 404 });
    });

    const client = createWebexClient({ token: "test" });
    const result = await client.getThreadContext({ roomId: "r1", messageId: "child", maxReplies: 2 });
    assert.equal(result.root.id, "root");
    assert.deepEqual(result.replies.map((r) => r.id), ["a", "b"]);
    assert.equal(result.hasMore, true);
    assert.deepEqual(requests.map((request) => request.pathname), [
      "/v1/messages/child", "/v1/messages/root", "/v1/messages", "/v1/messages",
    ]);
    assert.equal(requests[2]?.searchParams.get("parentId"), "root");
    assert.equal(requests[2]?.searchParams.get("roomId"), "r1");
    assert.equal(requests[2]?.searchParams.get("max"), "2");
  });

  it("refuses to mix messages from different rooms", async () => {
    const requests: string[] = [];
    mock.method(globalThis, "fetch", async (input: string | URL) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      return Response.json({ id: "m1", roomId: "other", text: "private" });
    });
    const client = createWebexClient({ token: "test" });
    await assert.rejects(
      () => client.getThreadContext({ roomId: "r1", messageId: "m1" }),
      /different space/
    );
    assert.deepEqual(requests, ["/v1/messages/m1"]);
  });
});
