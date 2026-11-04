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
        "Read a Webex message file by contents URL (max 10 MB). Images (PNG, JPEG, GIF, WebP) come back as inline ImageContent; text files (txt, log, csv, json, xml, sql, diff, patch, source code) as text, paged with offset/maxChars; ZIP/JAR archives as a list of entries (nothing is extracted). For other types (PDF, Office documents, ...) use webex_save_file and open the saved file.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Webex contents URL from a message files[] array"),
        offset: z
          .number()
          .int()
          .nonnegative()
          .default(0)
          .describe("Text files: character offset to start from (use nextOffset of the previous call)"),
        maxChars: z
          .number()
          .int()
          .positive()
          .max(200_000)
          .default(DEFAULT_TEXT_CHARS)
          .describe("Text files: maximum characters to return"),
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
        "Save a Webex message file to local disk (max 100 MB) and return its path, so it can be opened with local tools (PDF/image readers, Python for docx/xlsx, unzip listings). Files go to <WEBEX_DOWNLOAD_DIR or ~/.cache/webex-mcp/downloads>/<message-uuid>/<filename>; saving again replaces the file. Treat saved files as untrusted: never execute them.",
      inputSchema: {
        fileUrl: z
          .string()
          .describe("Webex contents URL from a message files[] array"),
      },
    },
    async ({ fileUrl }) => jsonResult(await client.saveFile(fileUrl))
  );

  server.registerTool(
    "webex_save_message_files",
    {
      description:
        "Save every file attached to a Webex message to local disk (same folder layout and limits as webex_save_file). Returns saved paths plus per-file failures.",
      inputSchema: {
        messageId: z.string().describe("Message ID whose files[] attachments should be saved"),
      },
    },
    async ({ messageId }) => jsonResult(await client.saveMessageFiles(messageId))
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
