import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isVisionImage } from "../file-content.js";
import type { WebexClient } from "../webex.js";
import { imageResult, jsonResult } from "./common.js";

export function registerFileTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_get_file_details",
    {
      description:
        "Get metadata (filename, Content-Type, size) for a Webex message file URL from files[]. Does not download the body.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Webex contents URL from a message files[] array"),
      },
    },
    async ({ fileUrl }) => jsonResult(await client.getFileDetails(fileUrl))
  );

  server.registerTool(
    "webex_download_file",
    {
      description:
        "Download a Webex message file by contents URL. Image types (PNG, JPEG, GIF, WebP) are returned as inline ImageContent for LLM vision; other types return metadata only.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Webex contents URL from a message files[] array"),
      },
    },
    async ({ fileUrl }) => {
      const downloaded = await client.downloadFile(fileUrl);
      const summary = {
        url: downloaded.url,
        filename: downloaded.filename,
        contentType: downloaded.contentType,
        size: downloaded.size,
      };

      if (isVisionImage(downloaded.contentType, downloaded.filename)) {
        return imageResult(
          { ...summary, inlined: true },
          [{ mimeType: downloaded.contentType, data: downloaded.base64 }]
        );
      }

      return jsonResult({
        ...summary,
        inlined: false,
        note: "Not a vision image (PNG/JPEG/GIF/WebP); body not inlined",
      });
    }
  );

  server.registerTool(
    "webex_get_message_images",
    {
      description:
        "Download image attachments from a Webex message as inline ImageContent for LLM vision. Non-image files are listed in the summary and skipped.",
      inputSchema: {
        messageId: z.string().describe("Message ID whose files[] attachments should be downloaded"),
      },
    },
    async ({ messageId }) => {
      const { messages } = await client.getMessages({ messageId });
      const message = messages[0];
      if (!message) {
        throw new Error("Message not found");
      }

      const files = message.files ?? [];
      if (files.length === 0) {
        return jsonResult({
          messageId,
          images: 0,
          skipped: [],
          note: "Message has no file attachments",
        });
      }

      const images: Array<{ mimeType: string; data: string }> = [];
      const skipped: Array<Record<string, unknown>> = [];

      for (const fileUrl of files) {
        try {
          const downloaded = await client.downloadFile(fileUrl);
          if (isVisionImage(downloaded.contentType, downloaded.filename)) {
            images.push({
              mimeType: downloaded.contentType,
              data: downloaded.base64,
            });
          } else {
            skipped.push({
              fileUrl,
              filename: downloaded.filename,
              contentType: downloaded.contentType,
              reason: "not a vision image",
            });
          }
        } catch (err) {
          skipped.push({
            fileUrl,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return imageResult(
        { messageId, images: images.length, skipped },
        images
      );
    }
  );
}
