import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { TokenStore } from "../src/auth/token-store.js";
import type { TokenRecord } from "../src/auth/types.js";

describe("TokenStore", () => {
  let dir: string;
  let tokenPath: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "webex-mcp-tokens-"));
    tokenPath = join(dir, "tokens.json");
  });

  after(async () => {
    const store = new TokenStore(tokenPath);
    await store.clear();
  });

  it("returns null when token file is missing", async () => {
    const store = new TokenStore(join(dir, "missing.json"));
    assert.equal(await store.load(), null);
  });

  it("saves and loads token records with restricted permissions", async () => {
    const store = new TokenStore(tokenPath);
    const record: TokenRecord = {
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 120_000).toISOString(),
      scope: "spark:rooms_read",
    };

    await store.save(record);
    const loaded = await store.load();

    assert.deepEqual(loaded, record);

    const fileStat = await stat(tokenPath);
    const mode = fileStat.mode & 0o777;
    assert.equal(mode, 0o600);

    const raw = await readFile(tokenPath, "utf8");
    assert.match(raw, /access-1/);
  });

  it("clears stored tokens", async () => {
    const store = new TokenStore(tokenPath);
    await store.clear();
    assert.equal(await store.load(), null);
  });
});
