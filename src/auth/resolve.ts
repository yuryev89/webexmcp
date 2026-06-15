import { readOAuthConfig } from "./config.js";
import { TokenManager } from "./token-manager.js";
import { TokenStore } from "./token-store.js";
import type { OAuthConfig } from "./types.js";

export type ResolvedAuth =
  | {
      mode: "static";
      token: string;
      fedramp: boolean;
    }
  | {
      mode: "oauth";
      token: string;
      fedramp: boolean;
      tokenManager: TokenManager;
    };

export function resolveStaticToken(cliToken?: string): string | undefined {
  return cliToken ?? process.env.WEBEX_ACCESS_TOKEN;
}

export function createTokenManager(config: OAuthConfig): TokenManager {
  return new TokenManager(config, new TokenStore(config.tokenPath));
}

export async function resolveAuth(options: {
  cliToken?: string;
  fedramp?: boolean;
}): Promise<ResolvedAuth> {
  const staticToken = resolveStaticToken(options.cliToken);
  if (staticToken) {
    return {
      mode: "static",
      token: staticToken,
      fedramp: options.fedramp ?? false,
    };
  }

  const oauthConfig = readOAuthConfig({
    fedramp: options.fedramp ?? false,
  });

  if (!oauthConfig) {
    throw new Error(
      "Webex authentication is required. Pass --token, set WEBEX_ACCESS_TOKEN, " +
        "or configure WEBEX_CLIENT_ID and WEBEX_CLIENT_SECRET and run `webex-mcp login`."
    );
  }

  const tokenManager = createTokenManager(oauthConfig);
  const store = new TokenStore(oauthConfig.tokenPath);
  const existing = await store.load();

  if (!existing) {
    throw new Error(
      "No OAuth tokens found. Set WEBEX_CLIENT_ID and WEBEX_CLIENT_SECRET, " +
        "then run `webex-mcp login`."
    );
  }

  const token = await tokenManager.getAccessToken();

  return {
    mode: "oauth",
    token,
    fedramp: oauthConfig.fedramp,
    tokenManager,
  };
}

export async function getAuthStatus(): Promise<{
  mode: "static" | "oauth" | "none";
  status?: Awaited<ReturnType<TokenManager["getAuthStatus"]>>;
}> {
  if (resolveStaticToken()) {
    return { mode: "static" };
  }

  const oauthConfig = readOAuthConfig();
  if (!oauthConfig) {
    return { mode: "none" };
  }

  const tokenManager = createTokenManager(oauthConfig);
  const status = await tokenManager.getAuthStatus();
  return { mode: "oauth", status };
}

export async function logout(): Promise<void> {
  const oauthConfig = readOAuthConfig();
  if (!oauthConfig) {
    throw new Error(
      "OAuth is not configured. Set WEBEX_CLIENT_ID and WEBEX_CLIENT_SECRET to use logout."
    );
  }

  const tokenManager = createTokenManager(oauthConfig);
  await tokenManager.clearTokens();
}
