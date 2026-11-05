# MCP directory publication

The npm package [@yuryev89/webex-mcp](https://www.npmjs.com/package/@yuryev89/webex-mcp) is a **local stdio** MCP server. Do not submit it as a hosted remote endpoint.

## Official MCP Registry (automated)

Registry name: `io.github.yuryev89/webex-mcp`.

The repository includes `server.json` and an npm `mcpName` field for official registry ownership verification. The [npm publishing workflow](../.github/workflows/publish.yml) publishes to the official registry **after** verifying the new npm version is indexed. It authenticates using GitHub Actions OIDC; it needs no additional secrets, and re-running the workflow for an already published stable release also retries registry publishing.

The `server.json` versions are a template and are synchronized to the package's version in the workflow at release time. The version committed in this file is not by itself evidence that the matching npm version has the `mcpName` field; the first eligible version is the **next** npm release after merging this change. Publishing is not triggered by a PR alone.

Verification: https://registry.modelcontextprotocol.io/

Official instructions: https://modelcontextprotocol.io/registry/quickstart and https://modelcontextprotocol.io/registry/github-actions

## Community directories

Use the same product identity and description everywhere. Submit separately where the directory does not ingest the official registry.

| Directory | Entry method |
| --- | --- |
| [Glama](https://glama.ai/mcp/servers) | Add GitHub repository; obtain a quality score for the awesome list |
| [mcp.so](https://mcp.so/submit) | Submit GitHub repository under local MCP Server |
| [MCP.Directory](https://mcp.directory/submit) | GitHub repository URL + optional npm package |
| [MCP Servers](https://mcpservers.org/submit) | Web form (free review option); mark this server as local, not remote |
| [MCP Market](https://mcpmarket.com/submit) | GitHub repository form; free review queue available |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Fork and PR under Communication; include Glama quality-score badge |
| [PulseMCP](https://www.pulsemcp.com/servers) | Check automatic sync from official registry; direct submissions may be paused |

### Listing text

**Name:** Webex MCP

**Short description:** Connect AI agents to Cisco Webex spaces, messages, teams, webhooks, and file attachments.

**Repository:** https://github.com/yuryev89/webexmcp

**npm:** `@yuryev89/webex-mcp`

**Install:** `npx -y @yuryev89/webex-mcp@latest`

**Runtime:** Node.js 18+; TypeScript; stdio; MIT; Webex Bot token or OAuth 2.0.

**Capabilities:** List/search spaces, read/send/search messages within one space, manage space/team memberships, people, teams and webhooks, and handle received/sent file attachments. Search is per-space, not global. The Webex API enforces space membership and token permissions.

**Supported clients:** Cursor, Claude Desktop, Claude Code, Codex, OpenCode, and other stdio MCP clients.

Do not describe this server as Cisco's official MCP server or imply that the code has a hosted Streamable HTTP endpoint.
