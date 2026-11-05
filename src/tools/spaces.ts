import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

export function registerSpaceTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_list_spaces",
    {
      description: "List accessible spaces.",
      inputSchema: {
        type: z.enum(["group", "direct"]).optional().describe("Space type"),
        teamId: z.string().optional().describe("Team ID"),
        orgPublicSpaces: z
          .boolean()
          .optional()
          .describe("Org public spaces; incompatible with type"),
        from: z.string().optional().describe("Public since"),
        to: z.string().optional().describe("Public before"),
        max: z.number().int().positive().max(1000).default(100),
        sortBy: z.string().optional().describe("Sort field"),
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
        "Find spaces by case-insensitive title substring.",
      inputSchema: {
        query: z.string().describe("Title substring"),
        type: z.enum(["group", "direct"]).optional().describe("Space type"),
        teamId: z.string().optional().describe("Team ID filter"),
        sortBy: z
          .string()
          .optional()
          .describe('API scan order (default: lastactivity)'),
        maxResults: z.number().int().positive().max(100).default(20),
        scanLimit: z.number().int().positive().max(5000).default(500),
      },
    },
    async ({ query, type, teamId, sortBy, maxResults, scanLimit }) => {
      const params: {
        query: string;
        type?: "group" | "direct";
        teamId?: string;
        sortBy?: string;
        maxResults: number;
        scanLimit: number;
      } = { query, maxResults, scanLimit };
      if (type) params.type = type;
      if (teamId) params.teamId = teamId;
      if (sortBy) params.sortBy = sortBy;
      return jsonResult(await client.searchSpaces(params));
    }
  );

  server.registerTool(
    "webex_get_space",
    {
      description: "Get space by ID.",
      inputSchema: {
        roomId: z.string().describe("Space ID"),
      },
    },
    async ({ roomId }) => jsonResult(await client.getSpace(roomId))
  );

  server.registerTool(
    "webex_create_space",
    {
      description: "Create a space.",
      inputSchema: {
        title: z.string().describe("Title"),
        teamId: z.string().optional().describe("Team ID"),
        description: z.string().optional().describe("Description"),
        isLocked: z.boolean().optional().describe("Locked"),
        isPublic: z.boolean().optional().describe("Public to org"),
        isAnnouncementOnly: z.boolean().optional().describe("Moderators only"),
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
      description: "Update a space.",
      inputSchema: {
        roomId: z.string().describe("Space ID"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        isLocked: z.boolean().optional().describe("Locked"),
        isPublic: z.boolean().optional().describe("Public to org"),
        isAnnouncementOnly: z.boolean().optional().describe("Moderators only"),
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
      description: "Delete a space by ID.",
      inputSchema: {
        roomId: z.string().describe("Space ID"),
      },
    },
    async ({ roomId }) => jsonResult(await client.deleteSpace(roomId))
  );

  server.registerTool(
    "webex_get_space_meeting_info",
    {
      description: "Get space meeting details.",
      inputSchema: {
        roomId: z.string().describe("Space ID"),
      },
    },
    async ({ roomId }) => jsonResult(await client.getSpaceMeetingInfo(roomId))
  );
}
