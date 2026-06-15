import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { DEFAULT_SCOPES } from "../src/auth/config.js";
import { resolveAuth, resolveStaticToken } from "../src/auth/resolve.js";
import { TokenStore } from "../src/auth/token-store.js";
import type { TokenRecord } from "../src/auth/types.js";

describe("auth resolve", () => {
  const envSnapshot = {
    WEBEX_ACCESS_TOKEN: process.env.WEBEX_ACCESS_TOKEN,
    WEBEX_CLIENT_ID: process.env.WEBEX_CLIENT_ID,
    WEBEX_CLIENT_SECRET: process.env.WEBEX_CLIENT_SECRET,
    WEBEX_TOKEN_PATH: process.env.WEBEX_TOKEN_PATH,
  };
  let tokenPath: string;

  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), "webex-mcp-resolve-"));
    tokenPath = join(dir, "tokens.json");
  });

  after(() => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("resolveStaticToken prefers CLI token over env", () => {
    process.env.WEBEX_ACCESS_TOKEN = "env-token";
    assert.equal(resolveStaticToken("cli-token"), "cli-token");
    assert.equal(resolveStaticToken(), "env-token");
  });

  it("resolveAuth uses static token when provided", async () => {
    const auth = await resolveAuth({ cliToken: "static-token" });
    assert.equal(auth.mode, "static");
    if (auth.mode === "static") {
      assert.equal(auth.token, "static-token");
    }
  });

  it("resolveAuth uses OAuth tokens when static token is absent", async () => {
    delete process.env.WEBEX_ACCESS_TOKEN;
    process.env.WEBEX_CLIENT_ID = "client-id";
    process.env.WEBEX_CLIENT_SECRET = "client-secret";
    process.env.WEBEX_TOKEN_PATH = tokenPath;

    const record: TokenRecord = {
      access_token: "oauth-access",
      refresh_token: "oauth-refresh",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refresh_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      scope: DEFAULT_SCOPES,
    };
    await new TokenStore(tokenPath).save(record);

    const auth = await resolveAuth({});
    assert.equal(auth.mode, "oauth");
    if (auth.mode === "oauth") {
      assert.equal(auth.token, "oauth-access");
    }
  });

  it("resolveAuth fails when OAuth is configured but tokens are missing", async () => {
    delete process.env.WEBEX_ACCESS_TOKEN;
    process.env.WEBEX_CLIENT_ID = "client-id";
    process.env.WEBEX_CLIENT_SECRET = "client-secret";
    process.env.WEBEX_TOKEN_PATH = join(tmpdir(), "missing-webex-tokens.json");

    await assert.rejects(
      () => resolveAuth({}),
      /No OAuth tokens found/
    );
  });
});
