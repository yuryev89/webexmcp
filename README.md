# webex-mcp

Maintainers: see [Publishing a release](docs/RELEASING.md) for GitHub Releases and npm setup.

[![npm version](https://img.shields.io/npm/v/@yuryev89/webex-mcp)](https://www.npmjs.com/package/@yuryev89/webex-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@yuryev89/webex-mcp)](https://www.npmjs.com/package/@yuryev89/webex-mcp)
[![license](https://img.shields.io/npm/l/@yuryev89/webex-mcp)](LICENSE)

> MCP server for Cisco Webex Messaging — connect AI assistants to Webex spaces, messages, and people.

Minimal MCP server that exposes Webex messaging tools over stdio. Works with Cursor, Claude Desktop, Codex, Claude Code, OpenCode, and other MCP clients.

## Features

- Full core Webex Messaging API coverage: spaces, messages, memberships, people, teams, webhooks, attachment actions, and file downloads
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

## Codex configuration

Add one of the following configurations to `~/.codex/config.toml` (merge it with any existing configuration).

### Bot token

```toml
[mcp_servers.webex]
command = "npx"
args = ["-y", "@yuryev89/webex-mcp@latest"]

[mcp_servers.webex.env]
WEBEX_ACCESS_TOKEN = "YOUR_BOT_ACCESS_TOKEN"
```

### OAuth Integration

Complete [Option B — OAuth Integration](#option-b--oauth-integration) first, then use:

```toml
[mcp_servers.webex]
command = "npx"
args = ["-y", "@yuryev89/webex-mcp@latest"]

[mcp_servers.webex.env]
WEBEX_CLIENT_ID = "YOUR_CLIENT_ID"
WEBEX_CLIENT_SECRET = "YOUR_CLIENT_SECRET"
```

Alternatively, keep credentials in your shell environment and replace the `[mcp_servers.webex.env]` table with `env_vars = ["WEBEX_ACCESS_TOKEN"]` inside `[mcp_servers.webex]` (or `["WEBEX_CLIENT_ID", "WEBEX_CLIENT_SECRET"]` for OAuth). Start Codex from that shell.

Run `codex mcp list` to verify registration, then use `/mcp` in Codex to inspect the active server.

Reference: [Codex MCP documentation](https://developers.openai.com/codex/mcp).

## Claude Code configuration

The following commands register Webex for your user account across projects. Choose one authentication mode.

### Bot token

```bash
claude mcp add --scope user \
  --env WEBEX_ACCESS_TOKEN=YOUR_BOT_ACCESS_TOKEN \
  --transport stdio webex -- npx -y @yuryev89/webex-mcp@latest
```

### OAuth Integration

Complete [Option B — OAuth Integration](#option-b--oauth-integration) first, then register:

```bash
claude mcp add --scope user \
  --env WEBEX_CLIENT_ID=YOUR_CLIENT_ID \
  --env WEBEX_CLIENT_SECRET=YOUR_CLIENT_SECRET \
  --transport stdio webex -- npx -y @yuryev89/webex-mcp@latest
```

Run `claude mcp list` or `claude mcp get webex` to check the connection. Inside Claude Code, use `/mcp` to inspect status and tools. To switch modes, remove the existing entry with `claude mcp remove --scope user webex`, then register it again.

Reference: [Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).

## OpenCode configuration

Merge one of these examples into `opencode.json` in your project, or `~/.config/opencode/opencode.json` for all projects.

### Bot token

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "webex": {
      "type": "local",
      "command": ["npx", "-y", "@yuryev89/webex-mcp@latest"],
      "enabled": true,
      "environment": {
        "WEBEX_ACCESS_TOKEN": "{env:WEBEX_ACCESS_TOKEN}"
      }
    }
  }
}
```

Set `WEBEX_ACCESS_TOKEN` in your environment before launching OpenCode; `{env:...}` reads that variable.

### OAuth Integration

Complete [Option B — OAuth Integration](#option-b--oauth-integration) first, then use:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "webex": {
      "type": "local",
      "command": ["npx", "-y", "@yuryev89/webex-mcp@latest"],
      "enabled": true,
      "environment": {
        "WEBEX_CLIENT_ID": "{env:WEBEX_CLIENT_ID}",
        "WEBEX_CLIENT_SECRET": "{env:WEBEX_CLIENT_SECRET}"
      }
    }
  }
}
```

Keep `WEBEX_CLIENT_ID` and `WEBEX_CLIENT_SECRET` exported when launching OpenCode. Run `opencode mcp list` to check the server.

References: [OpenCode MCP documentation](https://opencode.ai/docs/mcp-servers/) and [configuration](https://opencode.ai/docs/config/).

## Client setup notes

- Each client starts the server as a local stdio process; no separate server terminal or HTTP URL is needed.
- OAuth login is handled by `npx -y @yuryev89/webex-mcp@latest login`. Run it under the same OS user and token-store configuration as the client. Client-native MCP OAuth login commands do not replace this step.
- For OAuth, remove `WEBEX_ACCESS_TOKEN` from the client configuration, inherited environment, and any loaded `.env`: a static token takes precedence over saved OAuth tokens.
- Replace credential placeholders locally. Keep real credentials out of version control; CLI arguments may also be retained in shell history.
- Ensure Node.js and `npx` are available to the client, then restart it after configuration changes.
- Try: **"Use Webex to list my spaces."** For a message search, identify a space first; `webex_search_messages` searches one space at a time.

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

### Files

| Tool | Description |
|------|-------------|
| `webex_get_file_details` | Metadata (filename, type, size) for a message `files[]` URL |
| `webex_download_file` | Download a file; images are returned as inline ImageContent |
| `webex_get_message_images` | Download all image attachments on a message for LLM vision |

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
- Message `files[]` URLs require the access token; use `webex_get_message_images` / `webex_download_file` instead of fetching the URL directly
- Inline vision images are limited to PNG, JPEG, GIF, and WebP, max 10 MB each

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

