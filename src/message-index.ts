import { createHash } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WebexClient } from "./webex.js";

export type MessageIndexClient = Pick<WebexClient, "getPerson" | "getSpace" | "getMessages">;
type Database = import("node:sqlite").DatabaseSync;
type IndexMode = "replace" | "incremental";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  person_email TEXT,
  created TEXT,
  parent_id TEXT,
  body TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_room_created ON messages(room_id, created DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
  USING fts5(body, content='messages', content_rowid='rowid', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body)
    VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, body)
    VALUES ('delete', old.rowid, old.body);
  INSERT INTO messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
`;

function validateRoomIds(roomIds: string[], max: number) {
  if (!roomIds.length || roomIds.length > max ||
      roomIds.some((id) => !id.trim())) {
    throw new Error(`roomIds must contain 1–${max} nonempty IDs`);
  }
  return [...new Set(roomIds.map((id) => id.trim()))];
}

export function createMessageIndex(client: MessageIndexClient, options?: { baseDir?: string }) {
  let userIdPromise: Promise<string> | undefined;

  async function openDatabase(): Promise<{ db: Database; path: string }> {
    userIdPromise ??= client.getPerson("me").then((person) => {
      if (!person.id) throw new Error("Cannot identify Webex account for local index");
      return person.id;
    });
    const userId = await userIdPromise;
    const hash = createHash("sha256").update(userId).digest("hex");
    const dir = options?.baseDir ?? join(homedir(), ".cache", "webex-mcp", "message-index");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const path = join(dir, `${hash}.sqlite`);
    const handle = await open(path, "a", 0o600);
    await handle.close();
    await chmod(path, 0o600);

    let sqlite: typeof import("node:sqlite");
    try {
      sqlite = await import("node:sqlite");
    } catch {
      throw new Error("Local FTS5 index requires Node.js 22.13+; other MCP tools still work on Node.js 18");
    }

    const db = new sqlite.DatabaseSync(path);
    try {
      db.exec(SCHEMA);
    } catch (error) {
      db.close();
      throw error;
    }
    return { db, path };
  }

  /**
   * Replace is an authoritative snapshot of the most recent N messages
   * per space and prunes missing/older rows. Incremental stops at the most
   * recently indexed message, but cannot discover deletion of older messages.
   */
  async function sync(params: {
    roomIds: string[];
    maxMessagesPerSpace?: number;
    mode?: IndexMode;
  }) {
    const roomIds = validateRoomIds(params.roomIds, 20);
    const maxMessages = Math.max(1, Math.min(params.maxMessagesPerSpace ?? 200, 2000));
    const mode = params.mode ?? "replace";
    const { db } = await openDatabase();
    const rooms: Array<{ roomId: string; fetched: number; complete: boolean }> = [];
    const errors: Array<{ roomId: string; error: string }> = [];
    const upsert = db.prepare(`
      INSERT INTO messages(id, room_id, person_email, created, parent_id, body, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        room_id=excluded.room_id, person_email=excluded.person_email,
        created=excluded.created, parent_id=excluded.parent_id,
        body=excluded.body, synced_at=excluded.synced_at
    `);
    try {
      for (const roomId of roomIds) {
        try {
          // Never index a space without live read access.
          await client.getSpace(roomId);
          const saved = mode === "incremental"
            ? db.prepare("SELECT id FROM messages WHERE room_id=? ORDER BY created DESC LIMIT 1")
                .get(roomId) as { id: string } | undefined
            : undefined;
          const entries: Awaited<ReturnType<MessageIndexClient["getMessages"]>>["messages"] = [];
          let cursor: string | undefined;
          let complete = false;
          const seen = new Set<string>();

          while (entries.length < maxMessages) {
            const pageMax = Math.min(100, maxMessages - entries.length);
            const page = await client.getMessages({
              roomId, max: pageMax,
              ...(cursor ? { beforeMessage: cursor } : {}),
            });
            if (!page.messages.length) {
              complete = true;
              break;
            }
            let hitWatermark = false;
            for (const message of page.messages) {
              if (!message.id || seen.has(message.id)) continue;
              if (message.id === saved?.id) {
                hitWatermark = true;
                break;
              }
              seen.add(message.id);
              entries.push(message);
            }
            if (hitWatermark) {
              complete = true;
              break;
            }
            if (page.messages.length < pageMax) {
              complete = true;
              break;
            }
            const next = page.messages.at(-1)?.id;
            if (!next || next === cursor) {
              throw new Error("Webex pagination did not advance");
            }
            cursor = next;
          }

          db.exec("BEGIN IMMEDIATE");
          try {
            if (mode === "replace") {
              db.prepare("DELETE FROM messages WHERE room_id=?").run(roomId);
            }
            const syncedAt = new Date().toISOString();
            for (const message of entries) {
              upsert.run(
                message.id!, roomId, message.personEmail ?? null,
                message.created ?? null, message.parentId ?? null,
                message.text ?? message.markdown ?? "", syncedAt
              );
            }
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
          rooms.push({ roomId, fetched: entries.length, complete });
        } catch (error) {
          errors.push({
            roomId,
            error: error instanceof Error ? error.message.slice(0, 200) : "Webex synchronization failed",
          });
        }
      }
      return { mode, rooms, failedSpaces: errors.length, errors };
    } finally {
      db.close();
    }
  }

  async function search(params: {
    query: string;
    roomIds?: string[];
    maxResults?: number;
  }) {
    const query = params.query.trim();
    if (!query) throw new Error("query must not be empty");
    const rooms = params.roomIds ? validateRoomIds(params.roomIds, 100) : [];
    const maxResults = Math.max(1, Math.min(params.maxResults ?? 20, 50));
    const { db } = await openDatabase();
    type Row = {
      id: string; room_id: string; person_email: string | null;
      created: string | null; parent_id: string | null; snippet: string;
    };
    let candidates: Row[];
    try {
      const roomSql = rooms.length
        ? ` AND m.room_id IN (${rooms.map(() => "?").join(",")})`
        : "";
      const statement = db.prepare(`
        SELECT m.id, m.room_id, m.person_email, m.created, m.parent_id,
               snippet(messages_fts, 0, '[', ']', '…', 25) AS snippet
        FROM messages_fts JOIN messages m ON m.rowid=messages_fts.rowid
        WHERE messages_fts MATCH ?${roomSql}
        ORDER BY bm25(messages_fts), m.created DESC LIMIT ?
      `);
      // Quote FTS5 input as a literal phrase; never interpolate user input in SQL.
      const literal = `"${query.replaceAll('"', '""')}"`;
      candidates = statement.all(literal, ...rooms, maxResults * 5) as Row[];
    } finally {
      db.close();
    }

    // Revalidate membership for every space before returning cached content:
    // losing access to a space must not expose stale indexed messages.
    const permissions = new Map<string, boolean>();
    const excludedSpaces: string[] = [];
    let staleMessages = 0;
    const messages: Array<{
      id: string; roomId: string; snippet: string;
      personEmail?: string; created?: string; parentId?: string;
    }> = [];
    for (const row of candidates) {
      if (!permissions.has(row.room_id)) {
        try {
          await client.getSpace(row.room_id);
          permissions.set(row.room_id, true);
        } catch {
          permissions.set(row.room_id, false);
          excludedSpaces.push(row.room_id);
        }
      }
      if (!permissions.get(row.room_id)) continue;
      // Space membership alone is insufficient: a rejoined member may not
      // be able to read historical messages. Recheck each message ID live.
      try {
        const live = await client.getMessages({ messageId: row.id });
        if (!live.messages.some((m) => m.id === row.id && m.roomId === row.room_id)) {
          staleMessages++;
          continue;
        }
      } catch {
        staleMessages++;
        continue;
      }
      messages.push({
        id: row.id, roomId: row.room_id, snippet: row.snippet,
        ...(row.person_email ? { personEmail: row.person_email } : {}),
        ...(row.created ? { created: row.created } : {}),
        ...(row.parent_id ? { parentId: row.parent_id } : {}),
      });
      if (messages.length >= maxResults) break;
    }

    return {
      query, returned: messages.length,
      partial: candidates.length >= maxResults * 5 || excludedSpaces.length > 0 || staleMessages > 0,
      excludedSpaces, staleMessages, messages,
    };
  }

  async function status() {
    const { db, path } = await openDatabase();
    try {
      const row = db.prepare(
        "SELECT COUNT(*) AS messages, COUNT(DISTINCT room_id) AS spaces FROM messages"
      ).get() as { messages: number; spaces: number };
      return { ...row, path, storage: "local SQLite FTS5" };
    } finally {
      db.close();
    }
  }

  async function purge(params?: { roomIds?: string[] }) {
    const roomIds = params?.roomIds ? validateRoomIds(params.roomIds, 100) : null;
    const { db } = await openDatabase();
    try {
      const before = (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as
        { count: number }).count;
      if (roomIds) {
        const stmt = db.prepare("DELETE FROM messages WHERE room_id=?");
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const roomId of roomIds) stmt.run(roomId);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      } else {
        db.exec("DELETE FROM messages");
      }
      const after = (db.prepare("SELECT COUNT(*) AS count FROM messages").get() as
        { count: number }).count;
      return { deleted: before - after, remaining: after };
    } finally {
      db.close();
    }
  }

  return { sync, search, status, purge };
}
