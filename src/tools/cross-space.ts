import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { searchAcrossSpaces } from "../cross-space-search.js";
import { jsonResult } from "./common.js";

export function registerCrossSpaceSearchTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_search_all_messages",
    {
      description: "Search across selected or up to N recent spaces; bounded live scan, not exhaustive global search.",
      inputSchema: {
        query: z.string().min(1).describe("Case-insensitive keyword"),
        roomIds: z.array(z.string().min(1)).min(1).max(100).optional()
          .describe("Exact spaces; omit to search recent spaces"),
        maxSpaces: z.number().int().positive().max(100).default(10)
          .describe("Recent spaces to scan when roomIds omitted"),
        maxResults: z.number().int().positive().max(100).default(20),
        scanLimitPerSpace: z.number().int().positive().max(2000).default(200),
        concurrency: z.number().int().positive().max(4).default(3),
        maxSnippetChars: z.number().int().min(80).max(2000).default(320),
        before: z.string().optional().describe("Search messages before date/time"),
      },
    },
    async ({ query, roomIds, maxSpaces, maxResults, scanLimitPerSpace, concurrency, maxSnippetChars, before }) => {
      const result = await searchAcrossSpaces(client, {
        query, maxSpaces, maxResults, scanLimitPerSpace, concurrency, maxSnippetChars,
        ...(roomIds ? { roomIds } : {}),
        ...(before ? { before } : {}),
      });
      return jsonResult(result);
    }
  );
}
