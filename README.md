# webex-mcp

> MCP server for Cisco Webex Messaging — connect AI assistants to Webex spaces, messages, and people.

Minimal MCP server that exposes Webex messaging tools over stdio. Works with Cursor, Claude Desktop, and other MCP clients.

## Features

- List and create Webex spaces
- Search spaces by name/title
- Invite people to spaces
- Read and search messages
- Find people by email or name
- Send messages to spaces or direct messages
- Bearer token authentication via `webex-node` SDK

## Requirements

- Node.js >= 18
- Webex Bot access token ([developer.webex.com](https://developer.webex.com))

## Quick start

```bash
# Run via npx (recommended)
npx -y @yuryev89/webex-mcp@latest --token YOUR_ACCESS_TOKEN

# Or install globally
npm install -g @yuryev89/webex-mcp
webex-mcp --token YOUR_ACCESS_TOKEN
```

## Cursor configuration

```json
{
  "mcpServers": {
    "webex": {
      "command": "bash",
      "args": [
        "-lc",
        "npx -y @yuryev89/webex-mcp@latest --token \"$WEBEX_ACCESS_TOKEN\""
      ],
      "env": {
        "WEBEX_ACCESS_TOKEN": "YOUR_BOT_ACCESS_TOKEN"
      }
    }
  }
}
```

## CLI options

| Option | Description | Default |
|--------|-------------|---------|
| `--token` | Webex access token | `$WEBEX_ACCESS_TOKEN` |
| `--fedramp` | Use FedRAMP endpoint | `false` |
| `--debug` | Log startup to stderr | `false` |

## Tools

| Tool | Description |
|------|-------------|
| `webex_list_spaces` | List spaces (rooms) for the authenticated user |
| `webex_search_spaces` | Search spaces by title/name (case-insensitive) |
| `webex_create_space` | Create a new space |
| `webex_add_membership` | Invite a person to a space |
| `webex_get_people` | Search people by email, name, or ID |
| `webex_get_messages` | List messages in a space or get one by ID |
| `webex_search_messages` | Keyword search within a single space |
| `webex_create_message` | Send a message to a space or DM |

## Limitations

- `webex_search_messages` works within a **single space** only (Webex REST API has no global search)
- Search scans message history page by page — may be slow in large spaces
- Bot must be a **member** of a space to read or post messages
- No OAuth flow in MVP — static access token only

## Full guide

See **[docs/HOWTO.md](docs/HOWTO.md)** for step-by-step setup: bot creation, scopes, Cursor config, example prompts, and troubleshooting.

## Local development

```bash
git clone https://github.com/yuryev89/webex-mcp
cd webex-mcp
npm install
cp .env.example .env
npm run dev -- --token "$WEBEX_ACCESS_TOKEN"
npm test
```

## License

MIT
