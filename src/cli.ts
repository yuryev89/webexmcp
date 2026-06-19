#!/usr/bin/env node
import "dotenv/config";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { readOAuthConfig } from "./auth/config.js";
import { runOAuthLogin } from "./auth/login-server.js";
import { getAuthStatus, logout, resolveAuth } from "./auth/resolve.js";
import { makeServer } from "./server.js";

const sharedOptions = {
  fedramp: {
    type: "boolean" as const,
    default: false,
    describe: "Use FedRAMP endpoint (webexapis.us)",
  },
};

async function runServer(argv: {
  token?: string | undefined;
  fedramp: boolean;
  debug: boolean;
}) {
  const auth = await resolveAuth({
    ...(argv.token ? { cliToken: argv.token } : {}),
    fedramp: argv.fedramp,
  });

  const server = makeServer({
    token: auth.token,
    fedramp: auth.fedramp,
    ...(auth.mode === "oauth"
      ? { getToken: () => auth.tokenManager.getAccessToken(true) }
      : {}),
  });

  await server.connectStdio();

  if (argv.debug) {
    console.error(`[webex-mcp] started via stdio (auth: ${auth.mode})`);
  }
}

async function runLogin(argv: {
  fedramp: boolean;
  noOpen: boolean;
  debug: boolean;
}) {
  const config = readOAuthConfig({ fedramp: argv.fedramp });
  if (!config) {
    console.error(
      "Error: WEBEX_CLIENT_ID and WEBEX_CLIENT_SECRET are required for OAuth login."
    );
    process.exit(1);
  }

  await runOAuthLogin(config, {
    openBrowser: !argv.noOpen,
    debug: argv.debug,
  });
  console.error("[webex-mcp] Authentication successful. Tokens saved.");
}

async function runAuthStatus() {
  const result = await getAuthStatus();

  if (result.mode === "static") {
    console.log(JSON.stringify({ mode: "static", authenticated: true }, null, 2));
    return;
  }

  if (result.mode === "none") {
    console.log(JSON.stringify({ mode: "none", authenticated: false }, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        mode: "oauth",
        ...result.status,
      },
      null,
      2
    )
  );
}

async function runLogout() {
  await logout();
  console.error("[webex-mcp] OAuth tokens removed.");
}

const argv = await yargs(hideBin(process.argv))
  .scriptName("webex-mcp")
  .option("token", {
    type: "string",
    describe: "Webex access token (or set WEBEX_ACCESS_TOKEN env var)",
  })
  .option("debug", {
    type: "boolean",
    default: false,
    describe: "Enable debug logging to stderr",
  })
  .command(
    "$0",
    "Start the MCP server (default)",
    (y) => y.options(sharedOptions),
    async (args) => {
      await runServer({
        token: args.token,
        fedramp: args.fedramp,
        debug: args.debug,
      });
    }
  )
  .command(
    "login",
    "Authenticate via Webex OAuth and save tokens",
    (y) =>
      y
        .options(sharedOptions)
        .option("no-open", {
          type: "boolean",
          default: false,
          describe: "Do not try to open the browser automatically",
        })
        .option("debug", {
          type: "boolean",
          default: false,
          describe: "Log OAuth callback requests to stderr",
        }),
    async (args) => {
      await runLogin({
        fedramp: args.fedramp,
        noOpen: args["no-open"],
        debug: args.debug,
      });
    }
  )
  .command("logout", "Remove stored OAuth tokens", () => undefined, async () => {
    await runLogout();
  })
  .command(
    "auth-status",
    "Show OAuth authentication status (no token values)",
    () => undefined,
    async () => {
      await runAuthStatus();
    }
  )
  .demandCommand(0, 1)
  .strict()
  .help()
  .parse();

void argv;
