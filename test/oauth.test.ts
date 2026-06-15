import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SCOPES } from "../src/auth/config.js";
import {
  buildAuthorizeUrl,
  formatOAuthCallbackError,
  parseCallbackQuery,
  tokenRecordFromResponse,
} from "../src/auth/oauth.js";
import type { OAuthConfig } from "../src/auth/types.js";

const config: OAuthConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:4321/oauth/callback",
  scopes: DEFAULT_SCOPES,
  tokenPath: "/tmp/tokens.json",
  fedramp: false,
};

describe("oauth", () => {
  it("buildAuthorizeUrl includes required OAuth parameters", () => {
    const url = buildAuthorizeUrl(config, "state-123");
    const parsed = new URL(url);

    assert.equal(parsed.origin, "https://webexapis.com");
    assert.equal(parsed.pathname, "/v1/authorize");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("client_id"), "client-id");
    assert.equal(parsed.searchParams.get("redirect_uri"), config.redirectUri);
    assert.equal(parsed.searchParams.get("scope"), DEFAULT_SCOPES);
    assert.equal(parsed.searchParams.get("state"), "state-123");
    assert.doesNotMatch(url, /scope=[^&]*\+/);
    assert.match(url, /scope=spark%3Arooms_read%20spark%3Arooms_write/);
  });

  it("buildAuthorizeUrl uses FedRAMP host when configured", () => {
    const url = new URL(buildAuthorizeUrl({ ...config, fedramp: true }, "state"));
    assert.equal(url.origin, "https://webexapis.us");
  });

  it("parseCallbackQuery extracts authorization code", () => {
    const params = new URLSearchParams("code=abc123&state=xyz");
    assert.deepEqual(parseCallbackQuery(params), { code: "abc123" });
  });

  it("parseCallbackQuery surfaces OAuth errors", () => {
    const params = new URLSearchParams("error=access_denied&error_description=User%20denied");
    const result = parseCallbackQuery(params);
    assert.ok("error" in result);
    assert.match(result.error, /access_denied/);
  });

  it("formatOAuthCallbackError adds integration scope guidance for invalid_scope", () => {
    const message = formatOAuthCallbackError(
      "invalid_scope: The requested scope is invalid.",
      DEFAULT_SCOPES
    );
    assert.match(message, /invalid_scope/);
    assert.match(message, /spark:kms/);
    assert.match(message, /developer\.webex\.com\/my-apps/);
  });

  it("tokenRecordFromResponse calculates expiry timestamps", () => {
    const before = Date.now();
    const record = tokenRecordFromResponse(
      {
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        refresh_token_expires_in: 7200,
        scope: "spark:rooms_read",
      },
      DEFAULT_SCOPES
    );
    const after = Date.now();

    assert.equal(record.access_token, "access");
    assert.equal(record.refresh_token, "refresh");
    assert.ok(Date.parse(record.expires_at) >= before + 3600 * 1000);
    assert.ok(Date.parse(record.expires_at) <= after + 3600 * 1000);
    assert.ok(Date.parse(record.refresh_token_expires_at) >= before + 7200 * 1000);
    assert.ok(Date.parse(record.refresh_token_expires_at) <= after + 7200 * 1000);
  });
});
