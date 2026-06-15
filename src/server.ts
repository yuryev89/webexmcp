import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createWebexClient, type WebexOpts } from "./webex.js";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function makeServer(opts: WebexOpts) {
  const client = createWebexClient(opts);

  const server = new McpServer(
    { name: "webex-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "webex_list_spaces",
    {
      description: "List Webex spaces (rooms) for the authenticated user.",
      inputSchema: {
        type: z.enum(["group", "direct"]).optional().describe("Filter by space type"),
        teamId: z.string().optional().describe("List rooms for a specific team"),
        max: z.number().int().positive().max(1000).default(100),
        sortBy: z.string().optional().describe("Field to sort results by"),
      },
    },
    async ({ type, teamId, max, sortBy }) => {
      const params: {
        type?: "group" | "direct";
        teamId?: string;
        max: number;
        sortBy?: string;
      } = { max };
      if (type) params.type = type;
      if (teamId) params.teamId = teamId;
      if (sortBy) params.sortBy = sortBy;
      const result = await client.listSpaces(params);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "webex_search_spaces",
    {
      description:
        "Search Webex spaces (rooms) by title/name. Case-insensitive substring match with pagination.",
      inputSchema: {
        query: z.string().describe("Space name or title substring to search for"),
        type: z.enum(["group", "direct"]).optional().describe("Filter by space type"),
        teamId: z.string().optional().describe("Limit search to rooms in a specific team"),
        maxResults: z.number().int().positive().max(100).default(20),
        scanLimit: z.number().int().positive().max(5000).default(500),
      },
    },
    async ({ query, type, teamId, maxResults, scanLimit }) => {
      const params: {
        query: string;
        type?: "group" | "direct";
        teamId?: string;
        maxResults: number;
        scanLimit: number;
      } = { query, maxResults, scanLimit };
      if (type) params.type = type;
      if (teamId) params.teamId = teamId;
      const result = await client.searchSpaces(params);
      return jsonResult(result);
    }
  );

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
      const result = await client.getMessages(params);
      return jsonResult(result);
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
      const result = await client.searchMessages(params);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "webex_get_people",
    {
      description: "Search for people in the organization by email, display name, or ID.",
      inputSchema: {
        email: z.string().optional().describe("Email address to search for"),
        displayName: z.string().optional().describe("Display name prefix to search for"),
        id: z.string().optional().describe("Person ID(s), up to 85 comma-separated"),
        max: z.number().int().positive().max(100).default(100),
      },
    },
    async ({ email, displayName, id, max }) => {
      if (!email && !displayName && !id) {
        throw new Error("At least one of email, displayName, or id is required");
      }
      const params: {
        email?: string;
        displayName?: string;
        id?: string;
        max: number;
      } = { max };
      if (email) params.email = email;
      if (displayName) params.displayName = displayName;
      if (id) params.id = id;
      const result = await client.getPeople(params);
      return jsonResult(result);
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
      const result = await client.createMessage(params);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "webex_create_space",
    {
      description: "Create a new Webex space (room).",
      inputSchema: {
        title: z.string().describe("Space title"),
        teamId: z.string().optional().describe("Team ID to associate the space with"),
        description: z.string().optional().describe("Space description"),
        isLocked: z.boolean().optional().describe("Whether the space is locked"),
        isPublic: z.boolean().optional().describe("Whether the space is a public org space"),
        isAnnouncementOnly: z.boolean().optional().describe("Whether only moderators can post"),
      },
    },
    async ({ title, teamId, description, isLocked, isPublic, isAnnouncementOnly }) => {
      const params: {
        title: string;
        teamId?: string;
        description?: string;
        isLocked?: boolean;
        isPublic?: boolean;
        isAnnouncementOnly?: boolean;
      } = { title };
      if (teamId) params.teamId = teamId;
      if (description) params.description = description;
      if (isLocked !== undefined) params.isLocked = isLocked;
      if (isPublic !== undefined) params.isPublic = isPublic;
      if (isAnnouncementOnly !== undefined) params.isAnnouncementOnly = isAnnouncementOnly;
      const result = await client.createSpace(params);
      return jsonResult(result);
    }
  );

  server.registerTool(
    "webex_add_membership",
    {
      description: "Add a person to a Webex space (invite by email or person ID).",
      inputSchema: {
        roomId: z.string().describe("Space ID"),
        personEmail: z.string().optional().describe("Email of the person to invite"),
        personId: z.string().optional().describe("Person ID to invite"),
        isModerator: z.boolean().optional().describe("Whether the person should be a moderator"),
      },
    },
    async ({ roomId, personEmail, personId, isModerator }) => {
      if (!personEmail && !personId) {
        throw new Error("At least one of personEmail or personId is required");
      }
      const params: {
        roomId: string;
        personEmail?: string;
        personId?: string;
        isModerator?: boolean;
      } = { roomId };
      if (personEmail) params.personEmail = personEmail;
      if (personId) params.personId = personId;
      if (isModerator !== undefined) params.isModerator = isModerator;
      const result = await client.addMembership(params);
      return jsonResult(result);
    }
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).server.oninitialized = async () => {
    server.sendToolListChanged();
  };

  return {
    connectStdio: async () => server.connect(new StdioServerTransport()),
  };
}
