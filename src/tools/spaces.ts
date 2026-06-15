import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

export function registerSpaceTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_list_spaces",
    {
      description: "List Webex spaces (rooms) for the authenticated user.",
      inputSchema: {
        type: z.enum(["group", "direct"]).optional().describe("Filter by space type"),
        teamId: z.string().optional().describe("List rooms for a specific team"),
        orgPublicSpaces: z
          .boolean()
          .optional()
          .describe("Show org public spaces (cannot be used with type)"),
        from: z.string().optional().describe("Filter rooms made public after this time"),
        to: z.string().optional().describe("Filter rooms made public before this time"),
        max: z.number().int().positive().max(1000).default(100),
        sortBy: z.string().optional().describe("Field to sort results by"),
      },
    },
    async ({ type, teamId, orgPublicSpaces, from, to, max, sortBy }) => {
      const params: {
        type?: "group" | "direct";
        teamId?: string;
        orgPublicSpaces?: boolean;
        from?: string;
        to?: string;
        max: number;
        sortBy?: string;
      } = { max };
      if (type) params.type = type;
      if (teamId) params.teamId = teamId;
      if (orgPublicSpaces !== undefined) params.orgPublicSpaces = orgPublicSpaces;
      if (from) params.from = from;
      if (to) params.to = to;
      if (sortBy) params.sortBy = sortBy;
      return jsonResult(await client.listSpaces(params));
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
      return jsonResult(await client.searchSpaces(params));
    }
  );

  server.registerTool(
    "webex_get_space",
    {
      description: "Get details of a Webex space (room) by ID.",
      inputSchema: {
        roomId: z.string().describe("Space (room) ID"),
      },
    },
    async ({ roomId }) => jsonResult(await client.getSpace(roomId))
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
      return jsonResult(await client.createSpace(params));
    }
  );

  server.registerTool(
    "webex_update_space",
    {
      description: "Update a Webex space (room).",
      inputSchema: {
        roomId: z.string().describe("Space (room) ID"),
        title: z.string().optional().describe("New space title"),
        description: z.string().optional().describe("New space description"),
        isLocked: z.boolean().optional().describe("Whether the space is locked"),
        isPublic: z.boolean().optional().describe("Whether the space is a public org space"),
        isAnnouncementOnly: z.boolean().optional().describe("Whether only moderators can post"),
      },
    },
    async ({ roomId, title, description, isLocked, isPublic, isAnnouncementOnly }) => {
      const params: {
        roomId: string;
        title?: string;
        description?: string;
        isLocked?: boolean;
        isPublic?: boolean;
        isAnnouncementOnly?: boolean;
      } = { roomId };
      if (title !== undefined) params.title = title;
      if (description !== undefined) params.description = description;
      if (isLocked !== undefined) params.isLocked = isLocked;
      if (isPublic !== undefined) params.isPublic = isPublic;
      if (isAnnouncementOnly !== undefined) params.isAnnouncementOnly = isAnnouncementOnly;
      return jsonResult(await client.updateSpace(params));
    }
  );

  server.registerTool(
    "webex_delete_space",
    {
      description: "Delete a Webex space (room) by ID.",
      inputSchema: {
        roomId: z.string().describe("Space (room) ID"),
      },
    },
    async ({ roomId }) => jsonResult(await client.deleteSpace(roomId))
  );

  server.registerTool(
    "webex_get_space_meeting_info",
    {
      description: "Get Webex meeting details for a specific space (room).",
      inputSchema: {
        roomId: z.string().describe("Space (room) ID"),
      },
    },
    async ({ roomId }) => jsonResult(await client.getSpaceMeetingInfo(roomId))
  );
}
