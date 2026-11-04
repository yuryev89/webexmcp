import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Version from package.json, so the release workflow (which only bumps package.json and the
 * lockfile) is the single source of truth. Resolves from both src/ (tsx) and dist/ (npm package).
 */
export const PACKAGE_VERSION = (require("../package.json") as { version: string }).version;
