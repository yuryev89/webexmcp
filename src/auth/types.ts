export type TokenRecord = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_token_expires_at: string;
  scope: string;
};

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  tokenPath: string;
  fedramp: boolean;
};

export type AuthStatus = {
  authenticated: boolean;
  access_token_expires_at?: string;
  refresh_token_expires_at?: string;
  scope?: string;
};
