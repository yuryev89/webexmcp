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
      description: "Find org people by email, name prefix or ID; one required.",
      inputSchema: {
        email: z.string().optional().describe("Email"),
        displayName: z.string().optional().describe("Name prefix"),
        id: z.string().optional().describe("Person IDs (up to 85, comma-separated)"),
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
        'Get person by ID; "me" selects current user.',
      inputSchema: {
        id: z.string().describe('Person ID or "me"'),
      },
    },
    async ({ id }) => jsonResult(await client.getPerson(id))
  );
}
