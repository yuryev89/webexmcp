import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";
import { validateMembershipInvite } from "./memberships.js";

export function registerTeamTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_list_teams",
    {
      description: "List teams for the authenticated user.",
      inputSchema: {
        max: z.number().int().positive().max(1000).default(100),
      },
    },
    async ({ max }) => jsonResult(await client.listTeams({ max }))
  );

  server.registerTool(
    "webex_create_team",
    {
      description: "Create a new Webex team.",
      inputSchema: {
        name: z.string().describe("Team name"),
        description: z.string().optional().describe("Team description"),
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
      description: "Get team details by ID.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
      },
    },
    async ({ teamId }) => jsonResult(await client.getTeam(teamId))
  );

  server.registerTool(
    "webex_update_team",
    {
      description: "Update a Webex team.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
        name: z.string().optional().describe("New team name"),
        description: z.string().optional().describe("New team description"),
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
      description: "Delete a Webex team by ID.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
      },
    },
    async ({ teamId }) => jsonResult(await client.deleteTeam(teamId))
  );

  server.registerTool(
    "webex_list_team_memberships",
    {
      description: "List team memberships.",
      inputSchema: {
        teamId: z.string().optional().describe("Filter by team ID"),
        personId: z.string().optional().describe("Filter by person ID"),
        personEmail: z.string().optional().describe("Filter by person email"),
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
      description: "Add a person to a Webex team.",
      inputSchema: {
        teamId: z.string().describe("Team ID"),
        personEmail: z.string().optional().describe("Email of the person to add"),
        personId: z.string().optional().describe("Person ID to add"),
        isModerator: z.boolean().optional().describe("Whether the person should be a team moderator"),
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
      description: "Get team membership details by ID.",
      inputSchema: {
        membershipId: z.string().describe("Team membership ID"),
      },
    },
    async ({ membershipId }) => jsonResult(await client.getTeamMembership(membershipId))
  );

  server.registerTool(
    "webex_update_team_membership",
    {
      description: "Update a team membership (e.g. moderator status).",
      inputSchema: {
        membershipId: z.string().describe("Team membership ID"),
        isModerator: z.boolean().optional().describe("Whether the person is a team moderator"),
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
      description: "Remove a person from a Webex team.",
      inputSchema: {
        membershipId: z.string().describe("Team membership ID to remove"),
      },
    },
    async ({ membershipId }) => jsonResult(await client.removeTeamMembership(membershipId))
  );
}
