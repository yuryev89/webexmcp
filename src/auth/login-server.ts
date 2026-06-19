import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { buildAuthorizeUrl, exchangeCode, formatOAuthCallbackError } from "./oauth.js";
import { TokenStore } from "./token-store.js";
import type { OAuthConfig } from "./types.js";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

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

/** Windows Internet Shortcut — opens the full URL without cmd.exe truncating at "&". */
export function formatWindowsUrlShortcut(url: string): string {
  return `[InternetShortcut]\r\nURL=${url}\r\n`;
}

export async function writeWindowsAuthorizeShortcut(url: string): Promise<string> {
  const filePath = join(
    tmpdir(),
    `webex-mcp-oauth-${randomBytes(4).toString("hex")}.url`
  );
  await writeFile(filePath, formatWindowsUrlShortcut(url), "utf8");
  return filePath;
}

async function openWindowsAuthorizeShortcut(shortcutPath: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  await execFileAsync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Start-Process ${JSON.stringify(shortcutPath)}`,
    ],
    { windowsHide: true }
  );
}

export async function runOAuthLogin(
  config: OAuthConfig,
  options: {
    openBrowser?: boolean;
    debug?: boolean;
    onReady?: (authorizeUrl: string, callbackBaseUrl: string) => void;
  } = {}
): Promise<string> {
  const redirectUrl = new URL(config.redirectUri);
  const callbackPath = redirectUrl.pathname || "/oauth/callback";
  const state = randomBytes(24).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(config, state);
  const store = new TokenStore(config.tokenPath);

  const log = (...args: unknown[]) => {
    if (options.debug) {
      console.error("[webex-mcp:login]", ...args);
    }
  };

  console.error(`[webex-mcp] Open this URL in your browser to authenticate:\n${authorizeUrl}`);

  let windowsShortcutPath: string | undefined;
  if (process.platform === "win32") {
    windowsShortcutPath = await writeWindowsAuthorizeShortcut(authorizeUrl);
    console.error(
      "[webex-mcp] Windows: CMD wraps long URLs — do not copy from the console.\n" +
        `Open this shortcut instead (double-click or Enter):\n${windowsShortcutPath}`
    );
  }

  if (options.openBrowser) {
    if (windowsShortcutPath) {
      try {
        await openWindowsAuthorizeShortcut(windowsShortcutPath);
      } catch {
        // Shortcut path is printed; user can open it manually.
      }
    } else {
      await tryOpenBrowser(authorizeUrl);
    }
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const portToken = redirectUrl.port;
    const listenPort = portToken === "0" ? 0 : Number(portToken) || 80;

    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      server.close();
      action();
    };

    const timeout = setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            "OAuth login timed out after 10 minutes. Run `webex-mcp login` again."
          )
        );
      });
    }, LOGIN_TIMEOUT_MS);

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (!req.url) {
          sendHtml(res, 400, "Bad Request", "Missing request URL.");
          return;
        }

        log("request", req.method, req.url);

        const requestUrl = new URL(req.url, config.redirectUri);

        if (requestUrl.pathname !== callbackPath) {
          sendHtml(res, 404, "Not Found", "Unknown path.");
          return;
        }

        const oauthError = requestUrl.searchParams.get("error");
        if (oauthError) {
          const description = requestUrl.searchParams.get("error_description");
          const rawError = description ? `${oauthError}: ${description}` : oauthError;
          const message = formatOAuthCallbackError(rawError, config.scopes);
          sendHtml(res, 400, "Authentication Failed", message);
          finish(() => reject(new Error(message)));
          return;
        }

        const code = requestUrl.searchParams.get("code");
        if (!code) {
          sendHtml(
            res,
            200,
            "Waiting for authentication",
            "Complete sign-in in your browser. You can close this tab once authentication succeeds."
          );
          return;
        }

        const returnedState = requestUrl.searchParams.get("state");
        if (!returnedState || returnedState !== state) {
          log("state mismatch", { expected: state, received: returnedState });
          sendHtml(
            res,
            400,
            "Authentication Failed",
            "This callback does not match the current login session. Close this tab, return to your terminal, " +
              "and open the authorize URL shown there. If you started login more than once, only the latest " +
              "session is valid — run `webex-mcp login` again if needed."
          );
          return;
        }

        const tokens = await exchangeCode(config, code);
        await store.save(tokens);

        sendHtml(
          res,
          200,
          "Webex authentication complete",
          "You can close this window and return to your terminal."
        );
        finish(() => resolve());
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        sendHtml(res, 500, "Authentication Failed", message);
        finish(() => reject(err instanceof Error ? err : new Error(message)));
      }
    });

    server.on("error", (err) => {
      finish(() => reject(err));
    });

    server.listen(listenPort, redirectUrl.hostname, () => {
      const address = server.address();
      const boundPort =
        address && typeof address === "object" ? address.port : listenPort;
      const callbackBaseUrl = `${redirectUrl.protocol}//${redirectUrl.hostname}:${boundPort}${callbackPath}`;
      options.onReady?.(authorizeUrl, callbackBaseUrl);
    });
  });

  return authorizeUrl;
}

export async function tryOpenBrowser(url: string): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  try {
    if (process.platform === "darwin") {
      await execFileAsync("open", [url]);
      return;
    }

    if (process.platform === "win32") {
      await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Start-Process ${JSON.stringify(url)}`,
        ],
        { windowsHide: true }
      );
      return;
    }

    await execFileAsync("xdg-open", [url]);
  } catch {
    // Browser open is best-effort; URL is already printed to stderr.
  }
}
