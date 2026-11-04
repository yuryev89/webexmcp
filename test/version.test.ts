import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { PACKAGE_VERSION } from "../src/version.js";

it("reports the package.json version", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  ) as { version: string };
  assert.equal(PACKAGE_VERSION, pkg.version);
});
