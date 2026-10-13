import { readFileSync } from "node:fs";

try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const tag = process.env.RELEASE_TAG;
  const name = "@yuryev89/webex-mcp";
  if (pkg.name !== name) throw new Error(`Expected package ${name}.`);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) {
    throw new Error("Only stable semantic versions can be published to latest.");
  }
  if (tag !== `v${pkg.version}`) throw new Error(`Expected tag v${pkg.version}, received ${tag}.`);
  if (process.env.RELEASE_PRERELEASE !== "false") throw new Error("Release must be marked as stable.");
  if (lock.name !== name || lock.version !== pkg.version ||
      lock.packages?.[""]?.name !== name || lock.packages?.[""]?.version !== pkg.version) {
    throw new Error("package-lock.json must match the package name and version.");
  }
  console.log(`Validated ${name}@${pkg.version} for ${tag}.`);
} catch (error) {
  console.error(`Invalid release: ${error.message}`);
  process.exitCode = 1;
}
