#!/usr/bin/env node
import "dotenv/config";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { makeServer } from "./server.js";

const argv = await yargs(hideBin(process.argv))
  .option("token", {
    type: "string",
    describe: "Webex access token (or set WEBEX_ACCESS_TOKEN env var)",
  })
  .option("fedramp", {
    type: "boolean",
    default: false,
    describe: "Use FedRAMP endpoint (webexapis.us)",
  })
  .option("debug", {
    type: "boolean",
    default: false,
    describe: "Enable debug logging to stderr",
  })
  .parse();

const token = argv.token ?? process.env.WEBEX_ACCESS_TOKEN;

if (!token) {
  console.error(
    "Error: Webex access token is required. Pass --token or set WEBEX_ACCESS_TOKEN."
  );
  process.exit(1);
}

const server = makeServer({
  token,
  fedramp: argv.fedramp,
});

await server.connectStdio();

if (argv.debug) {
  console.error("[webex-mcp] started via stdio");
}
