# Webex MCP — Step-by-Step Guide

MCP server for integrating Cisco Webex Messaging with AI assistants (Cursor, Claude Desktop, and others).

## 1. What It Is

- MCP server for Webex Teams / Messaging
- Lets an AI agent in Cursor read spaces, search messages, create rooms, invite people, and send messages

## 2. Requirements

- Node.js >= 18
- Webex / Cisco account
- Cursor (or another stdio MCP client)
- Access to [developer.webex.com](https://developer.webex.com)

## 3. Choose an Authentication Method

You can use either a **Bot token** (simpler) or **OAuth Integration** (user-delegated, auto-refresh).

---

## 3A. Bot Token Setup

### Step 1 — Create a Bot

1. Open [developer.webex.com/my-apps](https://developer.webex.com/my-apps) → **Create a New App**
2. Choose **Create a Bot**
3. Fill in: Bot name, Username, Icon
4. Save the **Bot Access Token** (shown once — copy it immediately)

> For quick testing you can use a temporary token from [Getting Started](https://developer.webex.com/docs/getting-started) (~12 hours), but a Bot is recommended for Cursor.

### Step 2 — Configure Bot Scopes

Enable these scopes in the bot settings:

| Scope | Purpose |
|-------|---------|
| `spark:rooms_read` | List and get spaces |
| `spark:rooms_write` | Create, update, and delete spaces |
| `spark:memberships_read` | List and get space memberships |
| `spark:memberships_write` | Invite, update, and remove members |
| `spark:messages_read` | Read and search messages |
| `spark:messages_write` | Send, update, and delete messages |
| `spark:people_read` | Search and get people |
| `spark:teams_read` | List and get teams |
| `spark:teams_write` | Create, update, and delete teams |
| `spark:webhooks_read` | List and get webhooks |
| `spark:webhooks_write` | Create, update, and delete webhooks |
| `spark:kms` | Access encrypted messages (required for OAuth integrations) |

Save your changes.

### Step 3 — Connect MCP in Cursor (Bot)

**Cursor → Settings → MCP → Add custom server**

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

---

## 3B. OAuth Integration Setup

Use OAuth when you want actions on behalf of your Webex user account with automatic token refresh (~14-day access token, ~90-day refresh token).

### Step 1 — Create an Integration

1. Open [developer.webex.com/my-apps](https://developer.webex.com/my-apps) → **Create a New App**
2. Choose **Create an Integration**
3. Set **Redirect URI** to exactly: `http://127.0.0.1:4321/oauth/callback`
4. Enable these scopes:

| Scope | Purpose |
|-------|---------|
| `spark:rooms_read` | List and get spaces |
| `spark:rooms_write` | Create, update, and delete spaces |
| `spark:memberships_read` | List and get space memberships |
| `spark:memberships_write` | Invite, update, and remove members |
| `spark:messages_read` | Read and search messages |
| `spark:messages_write` | Send, update, and delete messages |
| `spark:people_read` | Search and get people |
| `spark:teams_read` | List and get teams |
| `spark:teams_write` | Create, update, and delete teams |
| `spark:webhooks_read` | List and get webhooks |
| `spark:webhooks_write` | Create, update, and delete webhooks |
| `spark:kms` | Access encrypted messages (required for OAuth integrations) |

1. Save and copy **Client ID** and **Client Secret** (secret shown once)

### Step 2 — Authenticate Once

```bash
export WEBEX_CLIENT_ID="your-client-id"
export WEBEX_CLIENT_SECRET="your-client-secret"
npx -y @yuryev89/webex-mcp@latest login
```

Your browser opens the Webex sign-in page. After approval, tokens are saved to `~/.config/webex-mcp/tokens.json`.

Check status:

```bash
npx -y @yuryev89/webex-mcp@latest auth-status
```

### Step 3 — Connect MCP in Cursor (OAuth)

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

No `--token` needed — the server reads saved OAuth tokens and refreshes them automatically.

To sign out: `npx -y @yuryev89/webex-mcp@latest logout`

---

Restart Cursor. The `webex` server should appear in MCP with 37 tools.

Alternative — global install (Bot mode):

```bash
npm install -g @yuryev89/webex-mcp
```

```json
{
  "mcpServers": {
    "webex": {
      "command": "webex-mcp",
      "args": ["--token", "YOUR_BOT_ACCESS_TOKEN"]
    }
  }
}
```

## 4. Verify the Connection

Prompt in Cursor Agent:

```
Show my Webex spaces (first 10)
```

Expected behavior: the agent calls `webex_list_spaces` and returns a list of rooms.

Manual check from the terminal:

```bash
npx @yuryev89/webex-mcp@latest --token YOUR_TOKEN --debug
```

The process waits for stdio — use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) for a smoke test.

## 5. Common Scenarios (AI Prompts)

### Create a room and invite colleagues

```
Create a Webex space "Project Alpha", invite alice@example.com and bob@example.com,
and send a welcome message.
```

Tool chain: `webex_create_space` → `webex_add_membership` (×2) → `webex_create_message`

### Find a space by name

```
Find the space named "Support" and show the last 20 messages.
```

`webex_search_spaces` → `webex_get_messages`

### Search for a keyword in a room

```
In the "Project Alpha" space, find messages containing "deploy".
```

`webex_search_spaces` (get roomId) → `webex_search_messages`

### Find a person and send a DM

```
Find user ivan@example.com and send them the message "Hello!"
```

`webex_get_people` → `webex_create_message` with `toPersonEmail`

## 6. Tool Reference

### Spaces

| Tool | When to use |
|------|-------------|
| `webex_list_spaces` | List all rooms |
| `webex_search_spaces` | Find a room by name/title |
| `webex_get_space` | Get room details by ID |
| `webex_create_space` | Create a new room |
| `webex_update_space` | Update room title, description, or settings |
| `webex_delete_space` | Delete a room |
| `webex_get_space_meeting_info` | Get meeting info for a room |

### Messages

| Tool | When to use |
|------|-------------|
| `webex_get_messages` | Message history or a single message by ID |
| `webex_search_messages` | Search text within a room |
| `webex_create_message` | Send a message to a space or DM |
| `webex_update_message` | Edit an existing message |
| `webex_delete_message` | Delete a message |
| `webex_list_direct_messages` | List messages in a 1:1 room |
| `webex_create_attachment_action` | Submit a card form action |
| `webex_get_attachment_action` | Get attachment action details |

### Memberships

| Tool | When to use |
|------|-------------|
| `webex_list_memberships` | List members of a space |
| `webex_get_membership` | Get membership details |
| `webex_add_membership` | Invite someone to a room |
| `webex_update_membership` | Change moderator/monitor status |
| `webex_remove_membership` | Remove someone from a room |

### People

| Tool | When to use |
|------|-------------|
| `webex_get_people` | Find a person by email or name |
| `webex_get_person` | Get a person by ID (use `me` for yourself) |

### Teams

| Tool | When to use |
|------|-------------|
| `webex_list_teams` | List teams |
| `webex_create_team` | Create a team |
| `webex_get_team` | Get team details |
| `webex_update_team` | Update a team |
| `webex_delete_team` | Delete a team |
| `webex_list_team_memberships` | List team members |
| `webex_add_team_membership` | Add someone to a team |
| `webex_get_team_membership` | Get team membership details |
| `webex_update_team_membership` | Update team moderator status |
| `webex_remove_team_membership` | Remove someone from a team |

### Webhooks

| Tool | When to use |
|------|-------------|
| `webex_list_webhooks` | List registered webhooks |
| `webex_create_webhook` | Register a new webhook |
| `webex_get_webhook` | Get webhook details |
| `webex_update_webhook` | Update a webhook |
| `webex_delete_webhook` | Delete a webhook |

## 7. Limitations

- Message search works **within a single room only** (no global search API)
- Room search has **no global Webex API** — `webex_search_spaces` may scan your room list on first use
- `webex_search_messages` scans history page by page — can be slow in large rooms
- The bot must be a **member** of a space to read or post messages
- Dev tokens expire in ~12 hours; Bot tokens are long-lived
- Webex API rate limit: ~300 req/min
- Admin APIs (people CRUD, ECM folders, events audit, room tabs) are not included in this release

## 8. Troubleshooting

| Problem | Solution |
|---------|----------|
| MCP server won't start | Check Node >= 18: `node -v` |
| 401 Unauthorized | Token expired — update Bot token, or run `webex-mcp login` for OAuth |
| OAuth `redirect_uri_mismatch` | Redirect URI in Integration must match `WEBEX_REDIRECT_URI` exactly |
| OAuth `invalid_scope` | Enable **every** scope from Step 1 on your Integration (including `spark:kms`); compare with the OAuth Authorization URL on your Integration page; override with `WEBEX_SCOPES` if needed |
| `No OAuth tokens found` | Run `webex-mcp login` after setting client ID/secret |
| Refresh token expired | Run `webex-mcp logout` then `webex-mcp login` again |
| 403 Forbidden | Bot is missing scopes — check Step 2 |
| Empty spaces list | Bot is not in any room; create one via `webex_create_space` |
| Can't read messages | Bot is not a member of that room — add via `webex_add_membership` |
| Search found nothing | Increase `scanLimit`; verify `roomId`; query is case-insensitive |
| FedRAMP environment | Add `--fedramp` to args |

## 9. Local Development

```bash
git clone https://github.com/yuryev89/webexmcp
cd webexmcp
npm install
cp .env.example .env   # WEBEX_ACCESS_TOKEN=...
npm run dev -- --token "$WEBEX_ACCESS_TOKEN"
npm test
```

Cursor config for local development:

```json
{
  "mcpServers": {
    "webex-dev": {
      "command": "npm",
      "args": ["run", "dev", "--", "--token", "YOUR_TOKEN"],
      "cwd": "/path/to/webexmcp"
    }
  }
}
```

## 10. Security

- OAuth tokens are stored in `~/.config/webex-mcp/tokens.json` (mode 0600)
- Never commit `WEBEX_CLIENT_SECRET` or token files to git
- Use `env` in Cursor config; don't hardcode tokens in public repos
- Grant the bot only the scopes it needs
- Rotate the Bot Access Token if compromised
