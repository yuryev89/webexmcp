import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { normalizeEnvValue, readOAuthConfig } from "../src/auth/config.js";

describe("config", () => {
  const envSnapshot = {
    WEBEX_CLIENT_ID: process.env.WEBEX_CLIENT_ID,
    WEBEX_CLIENT_SECRET: process.env.WEBEX_CLIENT_SECRET,
  };

  before(() => {
    delete process.env.WEBEX_CLIENT_ID;
    delete process.env.WEBEX_CLIENT_SECRET;
  });

  after(() => {
    if (envSnapshot.WEBEX_CLIENT_ID === undefined) {
      delete process.env.WEBEX_CLIENT_ID;
    } else {
      process.env.WEBEX_CLIENT_ID = envSnapshot.WEBEX_CLIENT_ID;
    }

    if (envSnapshot.WEBEX_CLIENT_SECRET === undefined) {
      delete process.env.WEBEX_CLIENT_SECRET;
    } else {
      process.env.WEBEX_CLIENT_SECRET = envSnapshot.WEBEX_CLIENT_SECRET;
    }
  });

  it("normalizeEnvValue removes surrounding double quotes", () => {
    assert.equal(
      normalizeEnvValue('"Ccae51848b94eed2f3aa31dfb71462be228a992afaa784c300c2d37494fba4e6e"'),
      "Ccae51848b94eed2f3aa31dfb71462be228a992afaa784c300c2d37494fba4e6e"
    );
  });

  it("readOAuthConfig strips quotes from Windows-style env values", () => {
    process.env.WEBEX_CLIENT_ID =
      '"Ccae51848b94eed2f3aa31dfb71462be228a992afaa784c300c2d37494fba4e6e"';
    process.env.WEBEX_CLIENT_SECRET = '"secret-value"';

    const config = readOAuthConfig();
    assert.ok(config);
    assert.equal(
      config.clientId,
      "Ccae51848b94eed2f3aa31dfb71462be228a992afaa784c300c2d37494fba4e6e"
    );
    assert.equal(config.clientSecret, "secret-value");
  });
});
