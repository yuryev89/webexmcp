import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";
import { validateMembershipInvite } from "./memberships.js";

export function registerTeamTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_list_teams",
    {
      description: "List accessible teams.",
      inputSchema: {
        max: z.number().int().positive().max(1000).default(100),
      },
    },
    async ({ max }) => jsonResult(await client.listTeams({ max }))
  );

  server.registerTool(
    "webex_create_team",
    {
      description: "Create a team.",
      inputSchema: {
        name: z.string().describe("Name"),
        description: z.string().optional().describe("Description"),
      },
    },
    async ({ name, description }) => {
      const params: { name: string; description?: string } = { name };
      if (description) params.description = description;
      return jsonResult(await client.createTeam(params));
    }
  );

  server.registerTool(
    "webex_get_team",
    {
      description: "Get team by ID.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
      },
    },
    async ({ teamId }) => jsonResult(await client.getTeam(teamId))
  );

  server.registerTool(
    "webex_update_team",
    {
      description: "Update a team.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
        name: z.string().optional().describe("New name"),
        description: z.string().optional().describe("New description"),
      },
    },
    async ({ teamId, name, description }) => {
      const params: { teamId: string; name?: string; description?: string } = { teamId };
      if (name !== undefined) params.name = name;
      if (description !== undefined) params.description = description;
      return jsonResult(await client.updateTeam(params));
    }
  );

  server.registerTool(
    "webex_delete_team",
    {
      description: "Delete a team by ID.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
      },
    },
    async ({ teamId }) => jsonResult(await client.deleteTeam(teamId))
  );

  server.registerTool(
    "webex_list_team_memberships",
    {
      description: "List team members.",
      inputSchema: {
        teamId: z.string().optional().describe("Team ID filter"),
        personId: z.string().optional().describe("Person ID filter"),
        personEmail: z.string().optional().describe("Person email filter"),
        max: z.number().int().positive().max(1000).default(100),
      },
    },
    async ({ teamId, personId, personEmail, max }) => {
      const params: {
        teamId?: string;
        personId?: string;
        personEmail?: string;
        max: number;
      } = { max };
      if (teamId) params.teamId = teamId;
      if (personId) params.personId = personId;
      if (personEmail) params.personEmail = personEmail;
      return jsonResult(await client.listTeamMemberships(params));
    }
  );

  server.registerTool(
    "webex_add_team_membership",
    {
      description: "Add team member by personId or personEmail.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
        personEmail: z.string().optional().describe("Person email"),
        personId: z.string().optional().describe("Person ID"),
        isModerator: z.boolean().optional().describe("Team moderator"),
      },
    },
    async ({ teamId, personEmail, personId, isModerator }) => {
      validateMembershipInvite({
        ...(personEmail ? { personEmail } : {}),
        ...(personId ? { personId } : {}),
      });
      const params: {
        teamId: string;
        personEmail?: string;
        personId?: string;
        isModerator?: boolean;
      } = { teamId };
      if (personEmail) params.personEmail = personEmail;
      if (personId) params.personId = personId;
      if (isModerator !== undefined) params.isModerator = isModerator;
      return jsonResult(await client.addTeamMembership(params));
    }
  );

  server.registerTool(
    "webex_get_team_membership",
    {
      description: "Get team membership by ID.",
      inputSchema: {
        membershipId: z.string().describe("Team membership ID"),
      },
    },
    async ({ membershipId }) => jsonResult(await client.getTeamMembership(membershipId))
  );

  server.registerTool(
    "webex_update_team_membership",
    {
      description: "Update team member's moderator status.",
      inputSchema: {
        membershipId: z.string().describe("Team membership ID"),
        isModerator: z.boolean().optional().describe("Team moderator"),
      },
    },
    async ({ membershipId, isModerator }) => {
      const params: { membershipId: string; isModerator?: boolean } = { membershipId };
      if (isModerator !== undefined) params.isModerator = isModerator;
      return jsonResult(await client.updateTeamMembership(params));
    }
  );

  server.registerTool(
    "webex_remove_team_membership",
    {
      description: "Remove team member.",
      inputSchema: {
        membershipId: z.string().describe("Team membership ID"),
      },
    },
    async ({ membershipId }) => jsonResult(await client.removeTeamMembership(membershipId))
  );
}
