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
      description: "List webhooks.",
      inputSchema: {
        max: z.number().int().positive().max(1000).default(100),
      },
    },
    async ({ max }) => jsonResult(await client.listWebhooks({ max }))
  );

  server.registerTool(
    "webex_create_webhook",
    {
      description: "Create event webhook.",
      inputSchema: {
        name: z.string().describe("Webhook name"),
        targetUrl: z.string().describe("Event POST URL"),
        resource: z.string().describe("Resource (e.g. messages)"),
        event: z.string().describe("Event (created/updated/deleted)"),
        filter: z.string().optional().describe("Filter (e.g. roomId=...)"),
        secret: z.string().optional().describe("Signature secret"),
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
      description: "Get webhook by ID.",
      inputSchema: {
        webhookId: z.string().describe("Webhook ID"),
      },
    },
    async ({ webhookId }) => jsonResult(await client.getWebhook(webhookId))
  );

  server.registerTool(
    "webex_update_webhook",
    {
      description: "Update webhook.",
      inputSchema: {
        webhookId: z.string().describe("Webhook ID"),
        name: z.string().optional().describe("New name"),
        targetUrl: z.string().optional().describe("New POST URL"),
        resource: z.string().optional().describe("New resource"),
        event: z.string().optional().describe("New event"),
        filter: z.string().optional().describe("New filter"),
        secret: z.string().optional().describe("New signature secret"),
        status: z.string().optional().describe("Status (active/inactive)"),
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
      description: "Delete webhook by ID.",
      inputSchema: {
        webhookId: z.string().describe("Webhook ID"),
      },
    },
    async ({ webhookId }) => jsonResult(await client.deleteWebhook(webhookId))
  );
}
