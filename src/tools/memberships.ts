import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

export function validateMembershipInvite(params: {
  personEmail?: string;
  personId?: string;
}) {
  if (!params.personEmail && !params.personId) {
    throw new Error("At least one of personEmail or personId is required");
  }
}

export function registerMembershipTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_list_memberships",
    {
      description: "List memberships in Webex spaces.",
      inputSchema: {
        roomId: z.string().optional().describe("Filter by space ID"),
        personId: z.string().optional().describe("Filter by person ID"),
        personEmail: z.string().optional().describe("Filter by person email"),
        max: z.number().int().positive().max(1000).default(100),
      },
    },
    async ({ roomId, personId, personEmail, max }) => {
      const params: {
        roomId?: string;
        personId?: string;
        personEmail?: string;
        max: number;
      } = { max };
      if (roomId) params.roomId = roomId;
      if (personId) params.personId = personId;
      if (personEmail) params.personEmail = personEmail;
      return jsonResult(await client.listMemberships(params));
    }
  );

  server.registerTool(
    "webex_get_membership",
    {
      description: "Get membership details by ID.",
      inputSchema: {
        membershipId: z.string().describe("Membership ID"),
      },
    },
    async ({ membershipId }) => jsonResult(await client.getMembership(membershipId))
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
      validateMembershipInvite({
        ...(personEmail ? { personEmail } : {}),
        ...(personId ? { personId } : {}),
      });
      const params: {
        roomId: string;
        personEmail?: string;
        personId?: string;
        isModerator?: boolean;
      } = { roomId };
      if (personEmail) params.personEmail = personEmail;
      if (personId) params.personId = personId;
      if (isModerator !== undefined) params.isModerator = isModerator;
      return jsonResult(await client.addMembership(params));
    }
  );

  server.registerTool(
    "webex_update_membership",
    {
      description: "Update a space membership (e.g. moderator status).",
      inputSchema: {
        membershipId: z.string().describe("Membership ID"),
        isModerator: z.boolean().optional().describe("Whether the person is a moderator"),
        isMonitor: z.boolean().optional().describe("Whether the person is a room monitor"),
      },
    },
    async ({ membershipId, isModerator, isMonitor }) => {
      const params: {
        membershipId: string;
        isModerator?: boolean;
        isMonitor?: boolean;
      } = { membershipId };
      if (isModerator !== undefined) params.isModerator = isModerator;
      if (isMonitor !== undefined) params.isMonitor = isMonitor;
      return jsonResult(await client.updateMembership(params));
    }
  );

  server.registerTool(
    "webex_remove_membership",
    {
      description: "Remove a person from a Webex space.",
      inputSchema: {
        membershipId: z.string().describe("Membership ID to remove"),
      },
    },
    async ({ membershipId }) => jsonResult(await client.removeMembership(membershipId))
  );
}
