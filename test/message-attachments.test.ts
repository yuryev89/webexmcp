import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { registerMessageTools } from "../src/tools/messages.js";
import { createWebexClient } from "../src/webex.js";

const Webex = createRequire(import.meta.url)("webex-node");
const fileUrl = "https://example.com/report.pdf";

describe("message attachments through MCP", () => {
  let directory: string;
  let client: Client;
  let server: McpServer;
  let sent: Record<string, any>[];
  let contents: string[];
  let sendError: Error | undefined;
  let expireFirstAttempt: boolean;
  let refreshes: number;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "webex-attachments-"));
    sent = [];
    contents = [];
    sendError = undefined;
    expireFirstAttempt = false;
    refreshes = 0;
    // Keep our client, normalization and MCP validation real; replace only the
    // external SDK send boundary to avoid delivering messages to real people.
    mock.method(Webex, "init", () => ({ messages: {
      create: async (body: Record<string, any>) => {
        sent.push(body);
        if (expireFirstAttempt && sent.length === 1) {
          throw Object.assign(new Error("expired"), { statusCode: 401 });
        }
        if (sendError) throw sendError;
        if (body.files?.[0] && typeof body.files[0] !== "string") {
          let content = "";
          for await (const chunk of body.files[0]) content += chunk.toString();
          contents.push(content);
        }
        return { id: "msg-1", roomId: body.roomId, text: body.text,
          files: body.files ? ["https://webexapis.com/v1/contents/file-1"] : [] };
      },
    } }));
    server = new McpServer({ name: "test", version: "1" });
    registerMessageTools(server, createWebexClient({ token: "token", getToken: async () => {
      refreshes++;
      return "new-token";
    } }));
    client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  });

  const send = (args: Record<string, unknown>) => client.callTool({
    name: "webex_create_message", arguments: args,
  });

  it("sends a URL-only attachment and returns normalized file URLs", async () => {
    const result = await send({ roomId: "room-1", files: [fileUrl] });
    assert.equal(result.isError, undefined);
    assert.deepEqual(sent[0], { roomId: "room-1", files: [fileUrl] });
    const content = result.content as { type: string; text: string }[];
    assert.deepEqual(JSON.parse(content[0]!.text).files,
      ["https://webexapis.com/v1/contents/file-1"]);
  });

  it("preserves captions and DM/thread routing with a URL attachment", async () => {
    const args = { toPersonEmail: "alice@example.com", parentId: "parent-1",
      text: "Report", markdown: "**Report**", files: [fileUrl] };
    const result = await send(args);
    assert.equal(result.isError, undefined);
    assert.deepEqual(sent[0], args);
  });

  it("uploads a local file without text to a person ID", async () => {
    const filePath = join(directory, "отчёт.txt");
    await writeFile(filePath, "attachment contents");
    const result = await send({ toPersonId: "person-1", filePath });
    assert.equal(result.isError, undefined);
    assert.deepEqual(contents, ["attachment contents"]);
    assert.equal(sent[0]?.toPersonId, "person-1");
    assert.equal(sent[0]?.filePath, undefined);
    assert.equal(sent[0]?.files[0].path, filePath);
    assert.equal(sent[0]?.files[0].destroyed, true);
  });

  it("reopens a local file after token refresh", async () => {
    const filePath = join(directory, "report.txt");
    await writeFile(filePath, "retry contents");
    expireFirstAttempt = true;
    const result = await send({ roomId: "room-1", parentId: "parent-1", text: "Report", filePath });
    assert.equal(result.isError, undefined);
    assert.equal(refreshes, 1);
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0]?.files[0], sent[1]?.files[0]);
    assert.equal(sent[0]?.files[0].destroyed, true);
    assert.equal(sent[1]?.files[0].destroyed, true);
    assert.equal(sent[1]?.parentId, "parent-1");
    assert.equal(sent[1]?.text, "Report");
    assert.deepEqual(contents, ["retry contents"]);
  });

  it("closes the upload stream and surfaces API errors", async () => {
    const filePath = join(directory, "report.txt");
    await writeFile(filePath, "data");
    sendError = new Error("File rejected by Webex");
    const result = await send({ roomId: "room-1", filePath });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /File rejected by Webex/);
    assert.equal(sent[0]?.files[0].destroyed, true);
  });

  for (const [name, args] of [
    ["empty message", {}],
    ["empty files array", { text: "hi", files: [] }],
    ["non-HTTP URL", { text: "hi", files: ["file:///tmp/report.txt"] }],
    ["invalid URL", { text: "hi", files: ["not a url"] }],
    ["mixed upload modes", { text: "hi", files: [fileUrl], filePath: "/tmp/report.txt" }],
    ["relative local path", { text: "hi", filePath: "report.txt" }],
  ] as const) {
    it(`rejects ${name} before sending`, async () => {
      try {
        const result = await send({ roomId: "room-1", ...args });
        assert.equal(result.isError, true);
      } catch (error) {
        assert.ok(error instanceof McpError);
        assert.equal(error.code, -32602);
      }
      assert.equal(sent.length, 0);
    });
  }

  it("rejects missing files, directories and files over 100 MB", async () => {
    const oversized = join(directory, "large.txt");
    await writeFile(oversized, "");
    await truncate(oversized, 100 * 1024 * 1024 + 1);
    for (const filePath of [join(directory, "missing"), directory, oversized]) {
      const result = await send({ roomId: "room-1", text: "Report", filePath });
      assert.equal(result.isError, true, filePath);
    }
    assert.equal(sent.length, 0);
  });

  it("keeps sending text-only messages", async () => {
    const result = await send({ roomId: "room-1", text: "hello" });
    assert.equal(result.isError, undefined);
    assert.deepEqual(sent[0], { roomId: "room-1", text: "hello" });
  });
});
