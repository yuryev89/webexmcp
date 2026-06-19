import { homedir } from "node:os";
import { join } from "node:path";
import type { OAuthConfig } from "./types.js";

export const DEFAULT_SCOPES =
  "spark:rooms_read spark:rooms_write spark:memberships_read spark:memberships_write spark:messages_read spark:messages_write spark:people_read spark:teams_read spark:teams_write spark:webhooks_read spark:webhooks_write spark:kms";

export const DEFAULT_REDIRECT_URI = "http://127.0.0.1:4321/oauth/callback";

export const DEFAULT_TOKEN_PATH = join(homedir(), ".config", "webex-mcp", "tokens.json");

export const DEFAULT_SPACES_CACHE_PATH = join(
  homedir(),
  ".config",
  "webex-mcp",
  "spaces-cache.json"
);

export const DEFAULT_SPACES_CACHE_TTL_DAYS = 30;

export const DEFAULT_SPACES_CACHE_TTL_MS = DEFAULT_SPACES_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type SpacesCacheConfig = {
  enabled: boolean;
  cachePath: string;
  ttlMs: number;
  maxSpaces: number;
};

export function readSpacesCacheConfig(
  overrides: Partial<SpacesCacheConfig> = {}
): SpacesCacheConfig {
  const ttlDays = process.env.WEBEX_SPACES_CACHE_TTL_DAYS;
  const ttlHours = process.env.WEBEX_SPACES_CACHE_TTL_HOURS;
  const maxSpaces = process.env.WEBEX_SPACES_CACHE_MAX;

  let ttlMs = DEFAULT_SPACES_CACHE_TTL_MS;
  if (ttlHours) {
    ttlMs = Number.parseInt(ttlHours, 10) * 60 * 60 * 1000;
  } else if (ttlDays) {
    ttlMs = Number.parseInt(ttlDays, 10) * 24 * 60 * 60 * 1000;
  }

  return {
    enabled: overrides.enabled ?? process.env.WEBEX_SPACES_CACHE !== "false",
    cachePath: expandHome(
      overrides.cachePath ??
        process.env.WEBEX_SPACES_CACHE_PATH ??
        DEFAULT_SPACES_CACHE_PATH
    ),
    ttlMs: overrides.ttlMs ?? ttlMs,
    maxSpaces:
      overrides.maxSpaces ??
      (maxSpaces ? Number.parseInt(maxSpaces, 10) : 5000),
  };
}

export function expandHome(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/** Strip surrounding quotes Windows CMD includes when using set VAR="value". */
export function normalizeEnvValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim().replace(/\r/g, "");
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export function readOAuthConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig | null {
  const clientId =
    overrides.clientId ?? normalizeEnvValue(process.env.WEBEX_CLIENT_ID);
  const clientSecret =
    overrides.clientSecret ?? normalizeEnvValue(process.env.WEBEX_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    redirectUri:
      overrides.redirectUri ??
      normalizeEnvValue(process.env.WEBEX_REDIRECT_URI) ??
      DEFAULT_REDIRECT_URI,
    scopes:
      overrides.scopes ??
      normalizeEnvValue(process.env.WEBEX_SCOPES) ??
      DEFAULT_SCOPES,
    tokenPath: expandHome(
      overrides.tokenPath ??
        normalizeEnvValue(process.env.WEBEX_TOKEN_PATH) ??
        DEFAULT_TOKEN_PATH
    ),
    fedramp: overrides.fedramp ?? process.env.WEBEX_FEDRAMP === "true",
  };
}

export function getApiBaseUrl(fedramp: boolean): string {
  return fedramp ? "https://webexapis.us" : "https://webexapis.com";
}
