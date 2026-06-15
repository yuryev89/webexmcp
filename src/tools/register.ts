import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebexClient } from "../webex.js";
import { registerMembershipTools } from "./memberships.js";
import { registerMessageTools } from "./messages.js";
import { registerPeopleTools } from "./people.js";
import { registerSpaceTools } from "./spaces.js";
import { registerTeamTools } from "./teams.js";
import { registerWebhookTools } from "./webhooks.js";

export function registerAllTools(server: McpServer, client: WebexClient) {
  registerSpaceTools(server, client);
  registerMessageTools(server, client);
  registerMembershipTools(server, client);
  registerPeopleTools(server, client);
  registerTeamTools(server, client);
  registerWebhookTools(server, client);
}
