import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DEFAULT_TEXT_CHARS,
  classifyFile,
  decodeText,
  isVisionImage,
  listZipEntries,
  looksBinary,
  sliceText,
  type DownloadedFile,
} from "../file-content.js";
import type { WebexClient } from "../webex.js";
import { imageResult, jsonResult } from "./common.js";

/** Shape a downloaded file into the tool result its kind calls for. */
export function downloadResult(
  downloaded: DownloadedFile,
  opts: { offset?: number; maxChars?: number } = {}
) {
  const summary = {
    url: downloaded.url,
    filename: downloaded.filename,
    contentType: downloaded.contentType,
    size: downloaded.size,
  };

  if (isVisionImage(downloaded.contentType, downloaded.filename)) {
    return imageResult(
      { ...summary, kind: "image", inlined: true },
      [{ mimeType: downloaded.contentType, data: downloaded.base64 }]
    );
  }

  const kind = classifyFile(downloaded.contentType, downloaded.filename);
  const buffer = Buffer.from(downloaded.base64, "base64");

  if (kind === "text" && !looksBinary(buffer)) {
    const { text, ...paging } = sliceText(decodeText(buffer), opts.offset, opts.maxChars);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ ...summary, kind, ...paging }, null, 2) },
        { type: "text" as const, text },
      ],
    };
  }

  if (kind === "archive") {
    try {
      return jsonResult({ ...summary, kind, inlined: false, archive: listZipEntries(buffer) });
    } catch (err) {
      return jsonResult({
        ...summary,
        kind,
        inlined: false,
        note: `Could not list archive entries (${err instanceof Error ? err.message : String(err)}); use webex_save_file`,
      });
    }
  }

  return jsonResult({
    ...summary,
    kind: "binary",
    inlined: false,
    note: "Body not inlined; use webex_save_file and open the saved file with local tools",
  });
}

export function registerFileTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_get_file_details",
    {
      description:
        "Get attachment metadata (name, type, size); no body.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Message files[] contents URL"),
      },
    },
    async ({ fileUrl }) => jsonResult(await client.getFileDetails(fileUrl))
  );

  server.registerTool(
    "webex_download_file",
    {
      description:
        "Read attachment (max 10 MB): inline images, paged text, ZIP/JAR entry list. For PDF/Office/binary use webex_save_file.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Message files[] contents URL"),
        offset: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Text offset; use previous nextOffset"),
        maxChars: z
          .number()
          .int()
          .positive()
          .max(200_000)
          .default(DEFAULT_TEXT_CHARS)
          .describe("Max text characters"),
      },
    },
    async ({ fileUrl, offset, maxChars }) => {
      let downloaded: DownloadedFile;
      try {
        downloaded = await client.downloadFile(fileUrl);
      } catch (err) {
        if (err instanceof Error && /download limit/.test(err.message)) {
          throw new Error(`${err.message}; use webex_save_file to save it to disk instead`);
        }
        throw err;
      }
      return downloadResult(downloaded, { offset, maxChars });
    }
  );

  server.registerTool(
    "webex_save_file",
    {
      description:
        "Save attachment to local disk (max 100 MB); returns path for local readers. Directory: WEBEX_DOWNLOAD_DIR or ~/.cache/webex-mcp/downloads, under message ID. Overwrites existing file; never execute untrusted downloads.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Message files[] contents URL"),
      },
    },
    async ({ fileUrl }) => jsonResult(await client.saveFile(fileUrl))
  );

  server.registerTool(
    "webex_save_message_files",
    {
      description:
        "Save all message attachments locally (webex_save_file limits); return paths and failures.",
      inputSchema: {
        messageId: z.string().describe("Message ID"),
      },
    },
    async ({ messageId }) => jsonResult(await client.saveMessageFiles(messageId))
  );

  server.registerTool(
    "webex_get_message_images",
    {
      description:
        "Return message images inline for vision; report skipped non-images.",
      inputSchema: {
        messageId: z.string().describe("Message ID"),
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
