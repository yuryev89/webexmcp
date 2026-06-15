# webex-mcp

> MCP server for Cisco Webex Messaging — connect AI assistants to Webex spaces, messages, and people.

Minimal MCP server that exposes Webex messaging tools over stdio. Works with Cursor, Claude Desktop, and other MCP clients.

## Features

- Full core Webex Messaging API coverage: spaces, messages, memberships, people, teams, webhooks, and attachment actions
- Search spaces and messages by keyword (client-side scan)
- Bearer token authentication via `webex-node` SDK with REST fallback for select endpoints
- OAuth 2.0 Integration login with automatic token refresh

## Requirements

- Node.js >= 18
- Webex Bot access token **or** Webex Integration (OAuth) — [developer.webex.com](https://developer.webex.com)

## Quick start

### Option A — Bot token

```bash
# Run via npx (recommended)
npx -y @yuryev89/webex-mcp@latest --token YOUR_ACCESS_TOKEN

# Or install globally
npm install -g @yuryev89/webex-mcp
webex-mcp --token YOUR_ACCESS_TOKEN
```

### Option B — OAuth Integration

```bash
# 1. Set credentials (or use a .env file in your working directory)
export WEBEX_CLIENT_ID="your-client-id"
export WEBEX_CLIENT_SECRET="your-client-secret"

# 2. Authenticate once (opens browser)
npx -y @yuryev89/webex-mcp@latest login

# 3. Start MCP server (reads saved tokens, auto-refreshes)
npx -y @yuryev89/webex-mcp@latest
```

## Cursor configuration

### Bot token

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

### OAuth Integration

```json
{
  "mcpServers": {
    "webex": {
      "command": "npx",
      "args": ["-y", "@yuryev89/webex-mcp@latest"],
      "env": {
        "WEBEX_CLIENT_ID": "YOUR_CLIENT_ID",
        "WEBEX_CLIENT_SECRET": "YOUR_CLIENT_SECRET"
      }
    }
  }
}
```

Run `npx -y @yuryev89/webex-mcp@latest login` once before starting Cursor (with `WEBEX_CLIENT_ID` and `WEBEX_CLIENT_SECRET` set).

## CLI options

| Option / Command | Description | Default |
|------------------|-------------|---------|
| `--token` | Webex access token (Bot mode) | `$WEBEX_ACCESS_TOKEN` |
| `--fedramp` | Use FedRAMP endpoint | `false` |
| `--debug` | Log startup to stderr | `false` |
| `login` | OAuth browser login, save tokens | — |
| `logout` | Remove stored OAuth tokens | — |
| `auth-status` | Show OAuth expiry metadata | — |

## Tools

### Spaces

| Tool | Description |
|------|-------------|
| `webex_list_spaces` | List spaces (rooms) for the authenticated user |
| `webex_search_spaces` | Search spaces by title/name (case-insensitive) |
| `webex_get_space` | Get space details by ID |
| `webex_create_space` | Create a new space |
| `webex_update_space` | Update a space |
| `webex_delete_space` | Delete a space |
| `webex_get_space_meeting_info` | Get meeting details for a space |

### Messages

| Tool | Description |
|------|-------------|
| `webex_get_messages` | List messages in a space or get one by ID |
| `webex_search_messages` | Keyword search within a single space |
| `webex_create_message` | Send a message to a space or DM |
| `webex_update_message` | Update an existing message |
| `webex_delete_message` | Delete a message |
| `webex_list_direct_messages` | List messages in a 1:1 direct room |
| `webex_create_attachment_action` | Submit an attachment card action |
| `webex_get_attachment_action` | Get attachment action details |

### Memberships

| Tool | Description |
|------|-------------|
| `webex_list_memberships` | List space memberships |
| `webex_get_membership` | Get membership details |
| `webex_add_membership` | Invite a person to a space |
| `webex_update_membership` | Update membership (e.g. moderator) |
| `webex_remove_membership` | Remove a person from a space |

### People

| Tool | Description |
|------|-------------|
| `webex_get_people` | Search people by email, name, or ID |
| `webex_get_person` | Get a person by ID (use `me` for yourself) |

### Teams

| Tool | Description |
|------|-------------|
| `webex_list_teams` | List teams |
| `webex_create_team` | Create a team |
| `webex_get_team` | Get team details |
| `webex_update_team` | Update a team |
| `webex_delete_team` | Delete a team |
| `webex_list_team_memberships` | List team memberships |
| `webex_add_team_membership` | Add a person to a team |
| `webex_get_team_membership` | Get team membership details |
| `webex_update_team_membership` | Update team membership |
| `webex_remove_team_membership` | Remove a person from a team |

### Webhooks

| Tool | Description |
|------|-------------|
| `webex_list_webhooks` | List webhooks |
| `webex_create_webhook` | Create a webhook |
| `webex_get_webhook` | Get webhook details |
| `webex_update_webhook` | Update a webhook |
| `webex_delete_webhook` | Delete a webhook |

## Limitations

- `webex_search_messages` works within a **single space** only (Webex REST API has no global search)
- Search scans message history page by page — may be slow in large spaces
- Bot must be a **member** of a space to read or post messages
- OAuth uses user-delegated tokens; Bot mode uses a long-lived Bot token

## Authentication modes

| Mode | Setup | Best for |
|------|-------|----------|
| **Bot token** | Copy token from developer portal | Simple Cursor setup, bot identity |
| **OAuth Integration** | `webex-mcp login` + client ID/secret | User-delegated access with auto-refresh |

## Full guide

See **[docs/HOWTO.md](docs/HOWTO.md)** for step-by-step setup: bot creation, scopes, Cursor config, example prompts, and troubleshooting.

## Local development

```bash
git clone https://github.com/yuryev89/webexmcp
cd webexmcp
npm install
cp .env.example .env
npm run dev -- --token "$WEBEX_ACCESS_TOKEN"
npm test
```

## License

MIT
