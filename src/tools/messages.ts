import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { isAbsolute } from "node:path";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

const includeFileDetailsSchema = z
  .boolean()
  .default(false)
  .describe(
    "Include attachment metadata; 1 HEAD request/file"
  );

export function validateDirectMessageParams(params: {
  personId?: string;
  personEmail?: string;
}) {
  if (!params.personId && !params.personEmail) {
    throw new Error("At least one of personId or personEmail is required");
  }
}

export function validateUpdateMessageParams(params: {
  messageId: string;
  text?: string;
  markdown?: string;
}) {
  if (!params.text && !params.markdown) {
    throw new Error("At least one of text or markdown is required");
  }
}

export function registerMessageTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_get_messages",
    {
      description:
        "Get one message by messageId or list space messages by roomId.",
      inputSchema: {
        roomId: z.string().optional().describe("Space ID for listing"),
        messageId: z.string().optional().describe("Message ID for single lookup"),
        before: z.string().optional().describe("Messages before date/time"),
        beforeMessage: z.string().optional().describe("Messages before this ID"),
        mentionedPeople: z.string().optional().describe("Mentioned person IDs"),
        max: z.number().int().positive().max(1000).default(50),
        includeFileDetails: includeFileDetailsSchema,
      },
    },
    async ({ roomId, messageId, before, beforeMessage, mentionedPeople, max, includeFileDetails }) => {
      const params: {
        roomId?: string;
        messageId?: string;
        before?: string;
        beforeMessage?: string;
        mentionedPeople?: string;
        max: number;
      } = { max };
      if (roomId) params.roomId = roomId;
      if (messageId) params.messageId = messageId;
      if (before) params.before = before;
      if (beforeMessage) params.beforeMessage = beforeMessage;
      if (mentionedPeople) params.mentionedPeople = mentionedPeople;
      const result = await client.getMessages(params);
      if (includeFileDetails) {
        return jsonResult({ ...result, messages: await client.addFileDetails(result.messages) });
      }
      return jsonResult(result);
    }
  );

  server.registerTool(
    "webex_search_messages",
    {
      description:
        "Keyword search within one space; scans history, not global search.",
      inputSchema: {
        roomId: z.string().describe("Space ID"),
        query: z.string().describe("Case-insensitive text/markdown keyword"),
        maxResults: z.number().int().positive().max(100).default(20),
        scanLimit: z.number().int().positive().max(5000).default(500),
        before: z.string().optional().describe("Scan before date/time"),
      },
    },
    async ({ roomId, query, maxResults, scanLimit, before }) => {
      const params: {
        roomId: string;
        query: string;
        maxResults: number;
        scanLimit: number;
        before?: string;
      } = { roomId, query, maxResults, scanLimit };
      if (before) params.before = before;
      return jsonResult(await client.searchMessages(params));
    }
  );

  server.registerTool(
    "webex_create_message",
    {
      description: "Send to space (roomId) or person (toPersonEmail/Id); files allowed, text optional with files.",
      inputSchema: {
        roomId: z.string().optional().describe("Destination space ID"),
        text: z.string().optional().describe("Plain text"),
        markdown: z.string().optional().describe("Markdown text"),
        toPersonEmail: z.string().optional().describe("DM recipient email"),
        toPersonId: z.string().optional().describe("DM recipient ID"),
        parentId: z.string().optional().describe("Thread parent message ID"),
        files: z.array(z.string().url().refine(
          (value) => /^https?:\/\//i.test(value),
          "File URLs must use HTTP or HTTPS"
        )).min(1).optional().describe("Public HTTP(S) file URLs; incompatible with filePath"),
        filePath: z.string().refine(isAbsolute, "filePath must be an absolute path")
          .optional().describe("Server-local absolute path (max 100 MB); incompatible with files"),
      },
    },
    async ({ roomId, text, markdown, toPersonEmail, toPersonId, parentId, files, filePath }) => {
      if (files && filePath) {
        throw new Error("Use either files or filePath, not both");
      }
      if (!text && !markdown && !files?.length && !filePath) {
        throw new Error("At least one of text, markdown, files or filePath is required");
      }
      const params: {
        roomId?: string;
        text?: string;
        markdown?: string;
        toPersonEmail?: string;
        toPersonId?: string;
        parentId?: string;
        files?: string[];
        filePath?: string;
      } = {};
      if (roomId) params.roomId = roomId;
      if (text) params.text = text;
      if (markdown) params.markdown = markdown;
      if (toPersonEmail) params.toPersonEmail = toPersonEmail;
      if (toPersonId) params.toPersonId = toPersonId;
      if (parentId) params.parentId = parentId;
      if (files) params.files = files;
      if (filePath) params.filePath = filePath;
      return jsonResult(await client.createMessage(params));
    }
  );

  server.registerTool(
    "webex_update_message",
    {
      description: "Edit a message.",
      inputSchema: {
        messageId: z.string().describe("Message ID"),
        text: z.string().optional().describe("New plain text"),
        markdown: z.string().optional().describe("New markdown"),
        roomId: z.string().optional().describe("Space ID (sometimes required)"),
      },
    },
    async ({ messageId, text, markdown, roomId }) => {
      validateUpdateMessageParams({
        messageId,
        ...(text !== undefined ? { text } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
      });
      const params: {
        messageId: string;
        text?: string;
        markdown?: string;
        roomId?: string;
      } = { messageId };
      if (text !== undefined) params.text = text;
      if (markdown !== undefined) params.markdown = markdown;
      if (roomId) params.roomId = roomId;
      return jsonResult(await client.updateMessage(params));
    }
  );

  server.registerTool(
    "webex_delete_message",
    {
      description: "Delete a message by ID.",
      inputSchema: {
        messageId: z.string().describe("Message ID"),
      },
    },
    async ({ messageId }) => jsonResult(await client.deleteMessage(messageId))
  );

  server.registerTool(
    "webex_list_direct_messages",
    {
      description: "List 1:1 DM messages; personId or personEmail required.",
      inputSchema: {
        parentId: z.string().optional().describe("Thread parent ID"),
        personId: z.string().optional().describe("DM person ID"),
        personEmail: z.string().optional().describe("DM person email"),
        includeFileDetails: includeFileDetailsSchema,
      },
    },
    async ({ parentId, personId, personEmail, includeFileDetails }) => {
      validateDirectMessageParams({
        ...(personId ? { personId } : {}),
        ...(personEmail ? { personEmail } : {}),
      });
      const params: {
        parentId?: string;
        personId?: string;
        personEmail?: string;
      } = {};
      if (parentId) params.parentId = parentId;
      if (personId) params.personId = personId;
      if (personEmail) params.personEmail = personEmail;
      const result = await client.listDirectMessages(params);
      if (includeFileDetails) {
        return jsonResult({ ...result, messages: await client.addFileDetails(result.messages) });
      }
      return jsonResult(result);
    }
  );

  server.registerTool(
    "webex_create_attachment_action",
    {
      description: "Submit an action on a message card.",
      inputSchema: {
        messageId: z.string().describe("Card message ID"),
        type: z.string().describe("Action type (e.g. submit)"),
        inputs: z
          .record(z.unknown())
          .optional()
          .describe("Card form inputs"),
      },
    },
    async ({ messageId, type, inputs }) => {
      const params: {
        messageId: string;
        type: string;
        inputs?: Record<string, unknown>;
      } = { messageId, type };
      if (inputs) params.inputs = inputs;
      return jsonResult(await client.createAttachmentAction(params));
    }
  );

  server.registerTool(
    "webex_get_attachment_action",
    {
      description: "Get card action by ID.",
      inputSchema: {
        actionId: z.string().describe("Attachment action ID"),
      },
    },
    async ({ actionId }) => jsonResult(await client.getAttachmentAction(actionId))
  );
}
