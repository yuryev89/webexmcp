import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAllTools } from "./tools/register.js";
import { createWebexClient, type WebexOpts } from "./webex.js";

export function makeServer(opts: WebexOpts) {
  const client = createWebexClient(opts);

  const server = new McpServer(
    { name: "webex-mcp", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  registerAllTools(server, client);

  void client.ensureSpacesCacheFresh().catch(() => undefined);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).server.oninitialized = async () => {
    server.sendToolListChanged();
  };

  return {
    connectStdio: async () => server.connect(new StdioServerTransport()),
  };
}
