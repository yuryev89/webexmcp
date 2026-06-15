import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthConfig } from "./types.js";

export const DEFAULT_SCOPES =
  "spark:rooms_read spark:rooms_write spark:memberships_read spark:memberships_write spark:messages_read spark:messages_write spark:people_read spark:teams_read spark:teams_write spark:webhooks_read spark:webhooks_write spark:kms";

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:4321/oauth/callback";

export const DEFAULT_TOKEN_PATH = join(homedir(), ".config", "webex-mcp", "tokens.json");

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function readOAuthConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig | null {
  const clientId = overrides.clientId ?? process.env.WEBEX_CLIENT_ID;
  const clientSecret = overrides.clientSecret ?? process.env.WEBEX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri:
      overrides.redirectUri ??
      process.env.WEBEX_REDIRECT_URI ??
      DEFAULT_REDIRECT_URI,
    scopes: overrides.scopes ?? process.env.WEBEX_SCOPES ?? DEFAULT_SCOPES,
    tokenPath: expandHome(
      overrides.tokenPath ?? process.env.WEBEX_TOKEN_PATH ?? DEFAULT_TOKEN_PATH
    ),
    fedramp: overrides.fedramp ?? process.env.WEBEX_FEDRAMP === "true",
  };
}

export function getApiBaseUrl(fedramp: boolean): string {
  return fedramp ? "https://webexapis.us" : "https://webexapis.com";
}
