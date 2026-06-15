import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { matchesSpaceTitle } from "./search.js";

export type CachedSpace = {
  id: string;
  title?: string;
  type?: string;
  teamId?: string;
  lastActivity?: string;
  isLocked?: boolean;
  isPublic?: boolean;
  isAnnouncementOnly?: boolean;
  created?: string;
  description?: string;
  creatorId?: string;
};

export type SpacesCacheRecord = {
  version: 1;
  syncedAt: string;
  ttlMs: number;
  complete: boolean;
  spaces: Record<string, CachedSpace>;
};

export type SpacesCacheSearchParams = {
  query: string;
  type?: "group" | "direct";
  teamId?: string;
  maxResults: number;
};

const FILE_MODE = 0o600;
const CACHE_VERSION = 1 as const;

export function createEmptyCacheRecord(ttlMs: number): SpacesCacheRecord {
  return {
    version: CACHE_VERSION,
    syncedAt: new Date(0).toISOString(),
    ttlMs,
    complete: false,
    spaces: {},
  };
}

export function isCacheExpired(record: SpacesCacheRecord, now = Date.now()): boolean {
  const syncedAt = Date.parse(record.syncedAt);
  if (Number.isNaN(syncedAt)) {
    return true;
  }
  return now - syncedAt > record.ttlMs;
}

export function searchCachedSpaces(
  record: SpacesCacheRecord,
  params: SpacesCacheSearchParams
): CachedSpace[] {
  const matched: CachedSpace[] = [];

  for (const space of Object.values(record.spaces)) {
    if (params.type && space.type !== params.type) {
      continue;
    }
    if (params.teamId && space.teamId !== params.teamId) {
      continue;
    }
    if (!matchesSpaceTitle(space, params.query)) {
      continue;
    }
    matched.push(space);
    if (matched.length >= params.maxResults) {
      break;
    }
  }

  return matched;
}

export function mergeCachedSpaces(
  primary: CachedSpace[],
  secondary: CachedSpace[],
  maxResults: number
): CachedSpace[] {
  const seen = new Set<string>();
  const merged: CachedSpace[] = [];

  for (const space of [...primary, ...secondary]) {
    if (seen.has(space.id)) {
      continue;
    }
    seen.add(space.id);
    merged.push(space);
    if (merged.length >= maxResults) {
      break;
    }
  }

  return merged;
}

export function upsertCachedSpaces(
  record: SpacesCacheRecord,
  spaces: CachedSpace[]
): SpacesCacheRecord {
  const nextSpaces = { ...record.spaces };

  for (const space of spaces) {
    nextSpaces[space.id] = space;
  }

  return { ...record, spaces: nextSpaces };
}

export function replaceCachedSpaces(
  record: SpacesCacheRecord,
  spaces: CachedSpace[],
  complete: boolean
): SpacesCacheRecord {
  return markCacheSynced(
    {
      ...record,
      spaces: Object.fromEntries(spaces.map((space) => [space.id, space])),
      complete,
    },
    complete
  );
}

export function removeCachedSpace(
  record: SpacesCacheRecord,
  roomId: string
): SpacesCacheRecord {
  const nextSpaces = { ...record.spaces };
  delete nextSpaces[roomId];
  return { ...record, spaces: nextSpaces };
}

export function markCacheSynced(record: SpacesCacheRecord, complete: boolean): SpacesCacheRecord {
  return {
    ...record,
    syncedAt: new Date().toISOString(),
    complete,
  };
}

export class SpacesCacheStore {
  constructor(
    private readonly cachePath: string,
    private readonly ttlMs: number
  ) {}

  async load(): Promise<SpacesCacheRecord> {
    try {
      const raw = await readFile(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as SpacesCacheRecord;
      if (parsed.version !== CACHE_VERSION) {
        return createEmptyCacheRecord(this.ttlMs);
      }
      return { ...parsed, ttlMs: this.ttlMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return createEmptyCacheRecord(this.ttlMs);
      }
      throw err;
    }
  }

  async save(record: SpacesCacheRecord): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });
    const tmpPath = `${this.cachePath}.tmp`;
    const payload = { ...record, ttlMs: this.ttlMs };
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), { mode: FILE_MODE });
    await chmod(tmpPath, FILE_MODE);
    await rename(tmpPath, this.cachePath);
    await chmod(this.cachePath, FILE_MODE);
  }
}
