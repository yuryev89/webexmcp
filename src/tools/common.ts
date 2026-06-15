import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebexClient } from "../webex.js";

export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export type ToolRegistrar = (server: McpServer, client: WebexClient) => void;
