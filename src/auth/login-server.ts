import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { buildAuthorizeUrl, exchangeCode, formatOAuthCallbackError, parseCallbackQuery } from "./oauth.js";
import { TokenStore } from "./token-store.js";
import type { OAuthConfig } from "./types.js";

function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1><p>${body}</p></body>
</html>`;
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  const content = htmlPage(title, body);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(content);
}

export async function runOAuthLogin(
  config: OAuthConfig,
  options: { openBrowser?: boolean } = {}
): Promise<string> {
  const redirectUrl = new URL(config.redirectUri);
  const callbackPath = redirectUrl.pathname || "/oauth/callback";
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state);
  const store = new TokenStore(config.tokenPath);

  console.error(`[webex-mcp] Open this URL in your browser to authenticate:\n${authorizeUrl}`);

  if (options.openBrowser) {
    await tryOpenBrowser(authorizeUrl);
  }

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          sendHtml(res, 400, "Bad Request", "Missing request URL.");
          return;
        }

        const requestUrl = new URL(req.url, config.redirectUri);

        if (requestUrl.pathname !== callbackPath) {
          sendHtml(res, 404, "Not Found", "Unknown path.");
          return;
        }

        const parsed = parseCallbackQuery(requestUrl.searchParams);
        if ("error" in parsed) {
          const message = formatOAuthCallbackError(parsed.error, config.scopes);
          sendHtml(res, 400, "Authentication Failed", message);
          reject(new Error(message));
          return;
        }

        const returnedState = requestUrl.searchParams.get("state");
        if (!returnedState || returnedState !== state) {
          const message = "Invalid or expired OAuth state. Run `webex-mcp login` again.";
          sendHtml(res, 400, "Authentication Failed", message);
          reject(new Error(message));
          return;
        }

        const tokens = await exchangeCode(config, parsed.code);
        await store.save(tokens);

        sendHtml(
          res,
          200,
          "Webex authentication complete",
          "You can close this window and return to your terminal."
        );
        resolve();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendHtml(res, 500, "Authentication Failed", message);
        reject(err);
      } finally {
        server.close();
      }
    });

    server.on("error", reject);

    server.listen(Number(redirectUrl.port) || 80, redirectUrl.hostname, () => {
      void authorizeUrl;
    });
  });

  return authorizeUrl;
}

export async function tryOpenBrowser(url: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const platform = process.platform;
  const command =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    await execFileAsync(command, args);
  } catch {
    // Browser open is best-effort; URL is already printed to stderr.
  }
}
