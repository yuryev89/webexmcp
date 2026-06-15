import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WebexClient } from "../webex.js";
import { jsonResult } from "./common.js";

export function validateCreateWebhook(params: {
  name: string;
  targetUrl: string;
  resource: string;
  event: string;
}) {
  if (!params.name || !params.targetUrl || !params.resource || !params.event) {
    throw new Error("name, targetUrl, resource, and event are required");
  }
}

export function registerWebhookTools(server: McpServer, client: WebexClient) {
  server.registerTool(
    "webex_list_webhooks",
    {
      description: "List webhooks for the authenticated user.",
      inputSchema: {
        max: z.number().int().positive().max(1000).default(100),
      },
    },
    async ({ max }) => jsonResult(await client.listWebhooks({ max }))
  );

  server.registerTool(
    "webex_create_webhook",
    {
      description: "Create a webhook to receive event notifications.",
      inputSchema: {
        name: z.string().describe("User-friendly webhook name"),
        targetUrl: z.string().describe("URL that receives POST requests for each event"),
        resource: z.string().describe("Resource type (e.g. messages, memberships)"),
        event: z.string().describe("Event type (e.g. created, updated, deleted)"),
        filter: z.string().optional().describe("Filter scope (e.g. roomId=...)"),
        secret: z.string().optional().describe("Secret used to validate webhook payloads"),
      },
    },
    async ({ name, targetUrl, resource, event, filter, secret }) => {
      validateCreateWebhook({ name, targetUrl, resource, event });
      const params: {
        name: string;
        targetUrl: string;
        resource: string;
        event: string;
        filter?: string;
        secret?: string;
      } = { name, targetUrl, resource, event };
      if (filter) params.filter = filter;
      if (secret) params.secret = secret;
      return jsonResult(await client.createWebhook(params));
    }
  );

  server.registerTool(
    "webex_get_webhook",
    {
      description: "Get webhook details by ID.",
      inputSchema: {
        webhookId: z.string().describe("Webhook ID"),
      },
    },
    async ({ webhookId }) => jsonResult(await client.getWebhook(webhookId))
  );

  server.registerTool(
    "webex_update_webhook",
    {
      description: "Update an existing webhook.",
      inputSchema: {
        webhookId: z.string().describe("Webhook ID"),
        name: z.string().optional().describe("New webhook name"),
        targetUrl: z.string().optional().describe("New target URL"),
        resource: z.string().optional().describe("New resource type"),
        event: z.string().optional().describe("New event type"),
        filter: z.string().optional().describe("New filter scope"),
        secret: z.string().optional().describe("New webhook secret"),
        status: z.string().optional().describe("Webhook status (active or inactive)"),
      },
    },
    async ({ webhookId, name, targetUrl, resource, event, filter, secret, status }) => {
      const params: {
        webhookId: string;
        name?: string;
        targetUrl?: string;
        resource?: string;
        event?: string;
        filter?: string;
        secret?: string;
        status?: string;
      } = { webhookId };
      if (name !== undefined) params.name = name;
      if (targetUrl !== undefined) params.targetUrl = targetUrl;
      if (resource !== undefined) params.resource = resource;
      if (event !== undefined) params.event = event;
      if (filter !== undefined) params.filter = filter;
      if (secret !== undefined) params.secret = secret;
      if (status !== undefined) params.status = status;
      return jsonResult(await client.updateWebhook(params));
    }
  );

  server.registerTool(
    "webex_delete_webhook",
    {
      description: "Delete a webhook by ID.",
      inputSchema: {
        webhookId: z.string().describe("Webhook ID"),
      },
    },
    async ({ webhookId }) => jsonResult(await client.deleteWebhook(webhookId))
  );
}
