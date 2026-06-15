import { refreshAccessToken } from "./oauth.js";
import { TokenStore } from "./token-store.js";
import type { AuthStatus, OAuthConfig, TokenRecord } from "./types.js";

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export class TokenManager {
  private refreshPromise: Promise<TokenRecord> | null = null;

  constructor(
    private readonly config: OAuthConfig,
    private readonly store: TokenStore
  ) {}

  async getAccessToken(forceRefresh = false): Promise<string> {
    const record = await this.getValidRecord(forceRefresh);
    return record.access_token;
  }

  async getAuthStatus(): Promise<AuthStatus> {
    const record = await this.store.load();
    if (!record) {
      return { authenticated: false };
    }

    const accessExpired = isExpired(record.expires_at);
    const refreshExpired = isExpired(record.refresh_token_expires_at);

    return {
      authenticated: !refreshExpired,
      access_token_expires_at: record.expires_at,
      refresh_token_expires_at: record.refresh_token_expires_at,
      scope: record.scope,
      ...(accessExpired && !refreshExpired ? { access_token_expired: true } : {}),
    } as AuthStatus & { access_token_expired?: boolean };
  }

  async clearTokens(): Promise<void> {
    await this.store.clear();
  }

  private async getValidRecord(forceRefresh: boolean): Promise<TokenRecord> {
    const record = await this.store.load();
    if (!record) {
      throw new Error(
        "No OAuth tokens found. Run `webex-mcp login` to authenticate."
      );
    }

    if (isExpired(record.refresh_token_expires_at)) {
      throw new Error(
        "Refresh token has expired. Delete stored tokens and run `webex-mcp login` again."
      );
    }

    if (forceRefresh || isNearExpiry(record.expires_at)) {
      return this.refresh(record);
    }

    return record;
  }

  private async refresh(record: TokenRecord): Promise<TokenRecord> {
    if (!this.refreshPromise) {
      this.refreshPromise = refreshAccessToken(this.config, record.refresh_token)
        .then(async (refreshed) => {
          await this.store.save(refreshed);
          return refreshed;
        })
        .finally(() => {
          this.refreshPromise = null;
        });
    }

    return this.refreshPromise;
  }
}

function isExpired(isoDate: string): boolean {
  return Date.parse(isoDate) <= Date.now();
}

function isNearExpiry(isoDate: string): boolean {
  return Date.parse(isoDate) - Date.now() <= EXPIRY_BUFFER_MS;
}
