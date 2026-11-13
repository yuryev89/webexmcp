import assert from "node:assert/strict";
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
  let uploadHeaders: Record<string, string>[];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "webex-attachments-"));
    sent = [];
    contents = [];
    sendError = undefined;
    expireFirstAttempt = false;
    refreshes = 0;
    uploadHeaders = [];
    // Keep our client, normalization and MCP validation real; replace only the
    // HTTP boundary to avoid delivering messages to real people. Local files go out
    // as multipart, everything else as JSON; both are recorded as plain objects.
    mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
      assert.match(String(url), /\/v1\/messages$/);
      assert.equal(init?.method, "POST");
      uploadHeaders.push({ ...(init.headers as Record<string, string>) });
      let body: Record<string, any> = {};
      if (init.body instanceof FormData) {
        for (const [key, value] of init.body.entries()) {
          if (key === "files") (body.files ??= []).push(value);
          else body[key] = value;
        }
      } else {
        body = JSON.parse(String(init.body));
      }
      sent.push(body);
      const json = (status: number, data: unknown) => new Response(JSON.stringify(data), {
        status, headers: { "content-type": "application/json" } });
      if (expireFirstAttempt && sent.length === 1) return json(401, { message: "expired" });
      if (sendError) return json(400, { message: sendError.message });
      if (body.files?.[0] instanceof Blob) contents.push(await body.files[0].text());
      return json(200, { id: "msg-1", roomId: body.roomId, text: body.text,
        files: body.files ? ["https://webexapis.com/v1/contents/file-1"] : [] });
    });
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
    assert.equal((sent[0]?.files[0] as File).name, "отчёт.txt");
  });

  // Review Focus 5
  it("posts a local file as multipart with its file name", async () => {
    const filePath = join(directory, "report.txt");
    await writeFile(filePath, "hello");
    const result = await send({ roomId: "room-1", text: "Report", filePath });
    assert.equal(result.isError, undefined);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.roomId, "room-1");
    assert.equal(sent[0]?.text, "Report");
    assert.equal(sent[0]?.files.length, 1);
    assert.ok(sent[0]?.files[0] instanceof Blob);
    assert.equal((sent[0]?.files[0] as File).name, "report.txt");
    assert.deepEqual(contents, ["hello"]);
    assert.equal(uploadHeaders[0]?.["Content-Type"], undefined);
  });

  it("resends a local file after token refresh", async () => {
    const filePath = join(directory, "report.txt");
    await writeFile(filePath, "retry contents");
    expireFirstAttempt = true;
    const result = await send({ roomId: "room-1", parentId: "parent-1", text: "Report", filePath });
    assert.equal(result.isError, undefined);
    assert.equal(refreshes, 1);
    assert.equal(sent.length, 2);
    assert.equal(uploadHeaders[1]?.Authorization, "Bearer new-token");
    assert.equal(sent[1]?.parentId, "parent-1");
    assert.equal(sent[1]?.text, "Report");
    assert.deepEqual(contents, ["retry contents"]);
  });

  it("surfaces API errors for local file uploads", async () => {
    const filePath = join(directory, "report.txt");
    await writeFile(filePath, "data");
    sendError = new Error("File rejected by Webex");
    const result = await send({ roomId: "room-1", filePath });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), /File rejected by Webex/);
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
    for (const [filePath, message] of [
      [join(directory, "missing"), /ENOENT/],
      [directory, /filePath must point to a regular file/],
      [oversized, /File exceeds the Webex 100 MB attachment limit/],
    ] as const) {
      const result = await send({ roomId: "room-1", text: "Report", filePath });
      assert.equal(result.isError, true, filePath);
      assert.match(JSON.stringify(result.content), message);
    }
    assert.equal(sent.length, 0);
  });

  it("keeps sending text-only messages", async () => {
    const result = await send({ roomId: "room-1", text: "hello" });
    assert.equal(result.isError, undefined);
    assert.deepEqual(sent[0], { roomId: "room-1", text: "hello" });
  });
});
