import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { DEFAULT_SCOPES } from "../src/auth/config.js";
import { runOAuthLogin } from "../src/auth/login-server.js";
import { TokenStore } from "../src/auth/token-store.js";
import type { OAuthConfig } from "../src/auth/types.js";

const REDIRECT_URI = "http://127.0.0.1:0/oauth/callback";

describe("runOAuthLogin", { concurrency: 1 }, () => {
  let tokenPath: string;
  let fetchMock: ReturnType<typeof mock.fn>;
  let config: OAuthConfig;

  before(async () => {
    const dir = await mkdtemp(join(tmpdir(), "webex-mcp-login-"));
    tokenPath = join(dir, "tokens.json");
    config = {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: REDIRECT_URI,
      scopes: DEFAULT_SCOPES,
      tokenPath,
      fedramp: false,
    };

    const originalFetch = globalThis.fetch;
    fetchMock = mock.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (!href.includes("webexapis.com")) {
        return originalFetch(input, init);
      }

      return {
        ok: true,
        json: async () => ({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          refresh_token_expires_in: 86400,
          scope: DEFAULT_SCOPES,
        }),
      };
    });
    mock.method(globalThis, "fetch", fetchMock);
  });

  after(async () => {
    mock.restoreAll();
    await new TokenStore(tokenPath).clear();
  });

  it("ignores favicon and stale callbacks, then accepts the valid callback", async () => {
    let authorizeUrl = "";
    let callbackBaseUrl = "";

    const loginPromise = runOAuthLogin(config, {
      openBrowser: false,
      onReady: (url, callbackUrl) => {
        authorizeUrl = url;
        callbackBaseUrl = callbackUrl;
      },
    });

    while (!authorizeUrl || !callbackBaseUrl) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const state = new URL(authorizeUrl).searchParams.get("state");
    assert.ok(state);

    const origin = callbackBaseUrl.replace(/\/oauth\/callback$/, "");
    await fetch(`${origin}/favicon.ico`);
    await fetch(`${callbackBaseUrl}?code=stale-code&state=wrong-state`);
    await fetch(callbackBaseUrl);

    const callback = await fetch(`${callbackBaseUrl}?code=valid-code&state=${state}`);
    assert.equal(callback.status, 200);

    await loginPromise;

    const store = new TokenStore(tokenPath);
    const tokens = await store.load();
    assert.equal(tokens?.access_token, "access-token");
  });

  it("rejects when Webex returns an OAuth error", async () => {
    let callbackBaseUrl = "";

    const loginPromise = runOAuthLogin(
      {
        ...config,
        tokenPath: join(tokenPath, "..", "tokens-error.json"),
      },
      {
        openBrowser: false,
        onReady: (_url, callbackUrl) => {
          callbackBaseUrl = callbackUrl;
        },
      }
    );

    const rejection = assert.rejects(loginPromise, /access_denied/);

    while (!callbackBaseUrl) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await fetch(`${callbackBaseUrl}?error=access_denied`);
    await rejection;
  });
});
