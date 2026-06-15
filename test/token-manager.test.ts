import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { DEFAULT_SCOPES } from "../src/auth/config.js";
import { TokenManager } from "../src/auth/token-manager.js";
import { TokenStore } from "../src/auth/token-store.js";
import type { OAuthConfig, TokenRecord } from "../src/auth/types.js";

const config: OAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:4321/oauth/callback",
  scopes: DEFAULT_SCOPES,
  tokenPath: "",
  fedramp: false,
};

describe("TokenManager", () => {
  let tokenPath: string;
  let store: TokenStore;
  let manager: TokenManager;
  let fetchMock: ReturnType<typeof mock.fn>;

  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), "webex-mcp-manager-"));
    tokenPath = join(dir, "tokens.json");
    config.tokenPath = tokenPath;
    store = new TokenStore(tokenPath);
    manager = new TokenManager(config, store);
    fetchMock = mock.fn();
    mock.method(globalThis, "fetch", fetchMock);
  });

  after(async () => {
    mock.restoreAll();
    await store.clear();
  });

  it("returns a valid access token without refreshing", async () => {
    const record: TokenRecord = {
      access_token: "valid-access",
      refresh_token: "valid-refresh",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scope: DEFAULT_SCOPES,
    };
    await store.save(record);

    const token = await manager.getAccessToken();
    assert.equal(token, "valid-access");
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it("refreshes expired access tokens and persists the new pair", async () => {
    const record: TokenRecord = {
      access_token: "expired-access",
      refresh_token: "valid-refresh",
      expires_at: new Date(Date.now() - 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scope: DEFAULT_SCOPES,
    };
    await store.save(record);

    fetchMock.mock.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 3600,
        refresh_token_expires_in: 7200,
        scope: DEFAULT_SCOPES,
      }),
    }));

    const token = await manager.getAccessToken();
    assert.equal(token, "new-access");
    assert.equal(fetchMock.mock.calls.length, 1);

    const saved = await store.load();
    assert.equal(saved?.access_token, "new-access");
    assert.equal(saved?.refresh_token, "new-refresh");
  });
});
