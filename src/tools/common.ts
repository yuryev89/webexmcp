import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebexClient } from "../webex.js";

export function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export type InlineImage = {
  mimeType: string;
  data: string;
};

export function imageResult(summary: unknown, images: InlineImage[]) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(summary, null, 2) },
      ...images.map((image) => ({
        type: "image" as const,
        mimeType: image.mimeType,
        data: image.data,
      })),
    ],
  };
}

export type ToolRegistrar = (server: McpServer, client: WebexClient) => void;
