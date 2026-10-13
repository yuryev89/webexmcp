import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const script = fileURLToPath(new URL("../scripts/check-release.mjs", import.meta.url));

const cases = [
  { title: "accepts a matching stable release", tag: "v0.2.6", version: "0.2.6", ok: true },
  { title: "rejects a tag for a different version", tag: "v0.2.5", version: "0.2.6", ok: false },
  { title: "rejects a tag without the v prefix", tag: "0.2.6", version: "0.2.6", ok: false },
  { title: "rejects a prerelease version on latest", tag: "v0.2.7-beta.1", version: "0.2.7-beta.1", ok: false },
  { title: "rejects a release marked as prerelease", tag: "v0.2.6", version: "0.2.6", prerelease: "true", ok: false },
  { title: "rejects a different package name", tag: "v0.2.6", version: "0.2.6", name: "wrong-package", ok: false },
  { title: "rejects a stale lockfile", tag: "v0.2.6", version: "0.2.6", lockVersion: "0.2.5", ok: false },
  { title: "rejects a stale lockfile root package", tag: "v0.2.6", version: "0.2.6", rootVersion: "0.2.5", ok: false },
];

for (const example of cases) {
  it(example.title, () => {
    const directory = mkdtempSync(join(tmpdir(), "webex-release-"));
    const name = example.name ?? "@yuryev89/webex-mcp";
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: example.version }));
      writeFileSync(join(directory, "package-lock.json"), JSON.stringify({
        name, version: example.lockVersion ?? example.version,
        packages: { "": { name, version: example.rootVersion ?? example.version } },
      }));
      const result = spawnSync(process.execPath, [script], {
        cwd: directory, encoding: "utf8",
        env: { ...process.env, RELEASE_TAG: example.tag, RELEASE_PRERELEASE: example.prerelease ?? "false" },
      });
      assert.equal(result.status, example.ok ? 0 : 1, result.stderr);
      if (!example.ok) assert.match(result.stderr, /Invalid release:/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
