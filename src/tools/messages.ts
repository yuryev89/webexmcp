import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

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
        "Get messages from a Webex space. Provide messageId for a single message, or roomId to list messages.",
      inputSchema: {
        roomId: z.string().optional().describe("Space ID (required for listing)"),
        messageId: z.string().optional().describe("Message ID (returns a single message)"),
        before: z.string().optional().describe("List messages sent before this date/time"),
        beforeMessage: z.string().optional().describe("List messages before this message ID"),
        mentionedPeople: z.string().optional().describe("Filter by mentioned people IDs"),
        max: z.number().int().positive().max(1000).default(50),
      },
    },
    async ({ roomId, messageId, before, beforeMessage, mentionedPeople, max }) => {
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
      return jsonResult(await client.getMessages(params));
    }
  );

  server.registerTool(
    "webex_search_messages",
    {
      description:
        "Search messages in a Webex space by keyword. Scans message history within a single room (no global search API).",
      inputSchema: {
        roomId: z.string().describe("Space ID to search in"),
        query: z.string().describe("Keyword to find in text or markdown (case-insensitive)"),
        maxResults: z.number().int().positive().max(100).default(20),
        scanLimit: z.number().int().positive().max(5000).default(500),
        before: z.string().optional().describe("Only scan messages before this date/time"),
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
      description: "Create a message in a Webex space or send a direct message.",
      inputSchema: {
        roomId: z.string().optional().describe("Space ID to post the message in"),
        text: z.string().optional().describe("Plain text message"),
        markdown: z.string().optional().describe("Markdown message"),
        toPersonEmail: z.string().optional().describe("Recipient email for a direct message"),
        toPersonId: z.string().optional().describe("Recipient person ID for a direct message"),
        parentId: z.string().optional().describe("Parent message ID for a thread reply"),
      },
    },
    async ({ roomId, text, markdown, toPersonEmail, toPersonId, parentId }) => {
      if (!text && !markdown) {
        throw new Error("At least one of text or markdown is required");
      }
      const params: {
        roomId?: string;
        text?: string;
        markdown?: string;
        toPersonEmail?: string;
        toPersonId?: string;
        parentId?: string;
      } = {};
      if (roomId) params.roomId = roomId;
      if (text) params.text = text;
      if (markdown) params.markdown = markdown;
      if (toPersonEmail) params.toPersonEmail = toPersonEmail;
      if (toPersonId) params.toPersonId = toPersonId;
      if (parentId) params.parentId = parentId;
      return jsonResult(await client.createMessage(params));
    }
  );

  server.registerTool(
    "webex_update_message",
    {
      description: "Update an existing Webex message.",
      inputSchema: {
        messageId: z.string().describe("Message ID to update"),
        text: z.string().optional().describe("New plain text content"),
        markdown: z.string().optional().describe("New markdown content"),
        roomId: z.string().optional().describe("Room ID (required for some message types)"),
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
      description: "Delete a Webex message by ID.",
      inputSchema: {
        messageId: z.string().describe("Message ID to delete"),
      },
    },
    async ({ messageId }) => jsonResult(await client.deleteMessage(messageId))
  );

  server.registerTool(
    "webex_list_direct_messages",
    {
      description: "List messages in a 1:1 direct message room.",
      inputSchema: {
        parentId: z.string().optional().describe("Parent message ID to filter by"),
        personId: z.string().optional().describe("Person ID for the 1:1 room"),
        personEmail: z.string().optional().describe("Person email for the 1:1 room"),
      },
    },
    async ({ parentId, personId, personEmail }) => {
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
      return jsonResult(await client.listDirectMessages(params));
    }
  );

  server.registerTool(
    "webex_create_attachment_action",
    {
      description: "Create an attachment action on a card message (e.g. form submit).",
      inputSchema: {
        messageId: z.string().describe("Message ID containing the attachment card"),
        type: z.string().describe("Action type (e.g. submit)"),
        inputs: z
          .record(z.unknown())
          .optional()
          .describe("Form field inputs from the card"),
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
      description: "Get details of an attachment action by ID.",
      inputSchema: {
        actionId: z.string().describe("Attachment action ID"),
      },
    },
    async ({ actionId }) => jsonResult(await client.getAttachmentAction(actionId))
  );
}
