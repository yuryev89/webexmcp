import { getApiBaseUrl } from "./config.js";
import type { OAuthConfig, TokenRecord } from "./types.js";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
  scope?: string;
  token_type?: string;
};

type TokenErrorResponse = {
  error?: string;
  error_description?: string;
};

export function buildAuthorizeUrl(config: OAuthConfig, state: string): string {
  const baseUrl = getApiBaseUrl(config.fedramp);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
  });
  // Webex rejects scope when spaces are encoded as "+" (URLSearchParams default).
  const query = `${params.toString()}&scope=${encodeURIComponent(config.scopes)}`;
  return `${baseUrl}/v1/authorize?${query}`;
}

export function tokenRecordFromResponse(
  response: TokenResponse,
  fallbackScope: string
): TokenRecord {
  const now = Date.now();
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: new Date(now + response.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(
      now + response.refresh_token_expires_in * 1000
    ).toISOString(),
    scope: response.scope ?? fallbackScope,
  };
}

async function postTokenRequest(
  config: OAuthConfig,
  body: Record<string, string>
): Promise<TokenRecord> {
  const baseUrl = getApiBaseUrl(config.fedramp);
  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...body,
  });

  const response = await fetch(`${baseUrl}/v1/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const payload = (await response.json()) as TokenResponse & TokenErrorResponse;

  if (!response.ok) {
    const message =
      payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    throw new Error(`Webex token request failed: ${message}`);
  }

  return tokenRecordFromResponse(payload, config.scopes);
}

export async function exchangeCode(
  config: OAuthConfig,
  code: string
): Promise<TokenRecord> {
  return postTokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
}

export async function refreshAccessToken(
  config: OAuthConfig,
  refreshToken: string
): Promise<TokenRecord> {
  return postTokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

export function formatOAuthCallbackError(error: string, scopes: string): string {
  if (!error.startsWith("invalid_scope")) {
    return error;
  }

  const scopeList = scopes
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => `  - ${scope}`)
    .join("\n");

  return `${error}

Each scope in the authorize URL must be enabled on your Webex Integration.
Open https://developer.webex.com/my-apps, edit your Integration, and check every scope below:

${scopeList}

spark:kms is required for encrypted message access and is included automatically on integrations.
Compare with the "OAuth Authorization URL" on your Integration page — scopes must match.`;
}

export function parseCallbackQuery(
  searchParams: URLSearchParams
): { code: string } | { error: string } {
  const error = searchParams.get("error");
  if (error) {
    const description = searchParams.get("error_description");
    return { error: description ? `${error}: ${description}` : error };
  }

  const code = searchParams.get("code");
  if (!code) {
    return { error: "Missing authorization code in callback" };
  }

  return { code };
}
