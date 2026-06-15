import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

export function validatePeopleSearch(params: {
  email?: string;
  displayName?: string;
  id?: string;
}) {
  if (!params.email && !params.displayName && !params.id) {
    throw new Error("At least one of email, displayName, or id is required");
  }
}

export function registerPeopleTools(server: McpServer, client: WebexClient) {
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
      validatePeopleSearch({
        ...(email ? { email } : {}),
        ...(displayName ? { displayName } : {}),
        ...(id ? { id } : {}),
      });
      const params: {
        email?: string;
        displayName?: string;
        id?: string;
        max: number;
      } = { max };
      if (email) params.email = email;
      if (displayName) params.displayName = displayName;
      if (id) params.id = id;
      return jsonResult(await client.getPeople(params));
    }
  );

  server.registerTool(
    "webex_get_person",
    {
      description:
        'Get a person by ID. Use id "me" to get the authenticated user\'s own details.',
      inputSchema: {
        id: z.string().describe('Person ID, or "me" for the authenticated user'),
      },
    },
    async ({ id }) => jsonResult(await client.getPerson(id))
  );
}
