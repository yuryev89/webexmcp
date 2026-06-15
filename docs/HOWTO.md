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

## 3. Step 1 — Create a Bot (Integration)

1. Open [developer.webex.com/my-apps](https://developer.webex.com/my-apps) → **Create a New App**
2. Choose **Create a Bot**
3. Fill in: Bot name, Username, Icon
4. Save the **Bot Access Token** (shown once — copy it immediately)

> For quick testing you can use a temporary token from [Getting Started](https://developer.webex.com/docs/getting-started) (~12 hours), but a Bot is recommended for Cursor.

## 4. Step 2 — Configure Bot Scopes

Enable these scopes in the bot settings:

| Scope | Purpose |
|-------|---------|
| `spark:rooms_read` | List spaces |
| `spark:rooms_write` | Create spaces |
| `spark:memberships_write` | Invite members |
| `spark:messages_read` | Read and search messages |
| `spark:messages_write` | Send messages |
| `spark:people_read` | Search people |

Save your changes.

## 5. Step 3 — Connect MCP in Cursor

**Cursor → Settings → MCP → Add custom server**

Recommended setup (token in env):

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

Alternative — global install:

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

Restart Cursor. The `webex` server should appear in MCP with 8 tools.

## 6. Step 4 — Verify the Connection

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

## 7. Step 5 — Common Scenarios (AI Prompts)

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

## 8. Tool Reference

| Tool | When to use |
|------|-------------|
| `webex_list_spaces` | List all rooms |
| `webex_search_spaces` | Find a room by name/title |
| `webex_create_space` | Create a new room |
| `webex_add_membership` | Invite someone to a room |
| `webex_get_people` | Find a person by email or name |
| `webex_get_messages` | Message history or a single message by ID |
| `webex_search_messages` | Search text within a room |
| `webex_create_message` | Send a message to a space or DM |

## 9. Limitations

- Message search works **within a single room only** (no global search API)
- `webex_search_messages` scans history page by page — can be slow in large rooms
- The bot must be a **member** of a space to read or post messages
- Dev tokens expire in ~12 hours; Bot tokens are long-lived
- Webex API rate limit: ~300 req/min

## 10. Troubleshooting

| Problem | Solution |
|---------|----------|
| MCP server won't start | Check Node >= 18: `node -v` |
| 401 Unauthorized | Token is invalid or expired — update Cursor config |
| 403 Forbidden | Bot is missing scopes — check Step 2 |
| Empty spaces list | Bot is not in any room; create one via `webex_create_space` |
| Can't read messages | Bot is not a member of that room — add via `webex_add_membership` |
| Search found nothing | Increase `scanLimit`; verify `roomId`; query is case-insensitive |
| FedRAMP environment | Add `--fedramp` to args |

## 11. Local Development

```bash
git clone https://github.com/yuryev89/webex-mcp
cd webex-mcp
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
      "cwd": "/path/to/webex-mcp"
    }
  }
}
```

## 12. Security

- Do not commit tokens to git
- Use `env` in Cursor config; don't hardcode tokens in public repos
- Grant the bot only the scopes it needs
- Rotate the Bot Access Token if compromised
