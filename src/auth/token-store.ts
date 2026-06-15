import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TokenRecord } from "./types.js";

const TOKEN_FILE_MODE = 0o600;

export class TokenStore {
  constructor(private readonly tokenPath: string) {}

  get path(): string {
    return this.tokenPath;
  }

  async load(): Promise<TokenRecord | null> {
    try {
      const raw = await readFile(this.tokenPath, "utf8");
      return JSON.parse(raw) as TokenRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async save(record: TokenRecord): Promise<void> {
    await mkdir(dirname(this.tokenPath), { recursive: true });
    const tmpPath = `${this.tokenPath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(record, null, 2), { mode: TOKEN_FILE_MODE });
    await chmod(tmpPath, TOKEN_FILE_MODE);
    await rename(tmpPath, this.tokenPath);
    await chmod(this.tokenPath, TOKEN_FILE_MODE);
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.tokenPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }
}
