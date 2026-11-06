import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { createMessageIndex } from "../message-index.js";
import { jsonResult } from "./common.js";

export function registerMessageIndexTools(server: McpServer, client: WebexClient) {
  // Indexing is only performed when one of the following tools is called.
  const index = createMessageIndex(client);

  server.registerTool(
    "webex_index_sync",
    {
      description: "Opt-in: index selected accessible Webex spaces locally (SQLite FTS5, Node 22.13+).",
      inputSchema: {
        roomIds: z.array(z.string().min(1)).min(1).max(20)
          .describe("Explicit spaces to index; max 20 per call"),
        maxMessagesPerSpace: z.number().int().positive().max(2000).default(200),
        mode: z.enum(["replace", "incremental"]).default("replace")
          .describe("Replace current snapshot or append since newest indexed message"),
      },
    },
    async ({ roomIds, maxMessagesPerSpace, mode }) =>
      jsonResult(await index.sync({ roomIds, maxMessagesPerSpace, mode }))
  );

  server.registerTool(
    "webex_index_search",
    {
      description: "FTS5 search of local index; checks live Webex space access before returning text.",
      inputSchema: {
        query: z.string().min(1).describe("Word or phrase (FTS5)"),
        roomIds: z.array(z.string().min(1)).min(1).max(100).optional()
          .describe("Optional space IDs to restrict search"),
        maxResults: z.number().int().positive().max(50).default(20),
      },
    },
    async ({ query, roomIds, maxResults }) =>
      jsonResult(await index.search({ query, maxResults, ...(roomIds ? { roomIds } : {}) }))
  );

  server.registerTool(
    "webex_index_status",
    {
      description: "Show local Webex message-index counts and SQLite file path.",
      inputSchema: {},
    },
    async () => jsonResult(await index.status())
  );

  server.registerTool(
    "webex_index_purge",
    {
      description: "Delete locally indexed Webex messages; irreversible, requires confirm=true.",
      inputSchema: {
        confirm: z.literal(true).describe("Required confirmation to delete local indexed data"),
        roomIds: z.array(z.string().min(1)).min(1).max(100).optional()
          .describe("Delete selected spaces; omit to clear entire account index"),
      },
    },
    async ({ roomIds }) =>
      jsonResult(await index.purge(roomIds ? { roomIds } : undefined))
  );
}
