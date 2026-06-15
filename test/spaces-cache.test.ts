import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyCacheRecord,
  isCacheExpired,
  mergeCachedSpaces,
  replaceCachedSpaces,
  searchCachedSpaces,
  upsertCachedSpaces,
} from "../src/spaces-cache.js";

describe("spaces cache", () => {
  it("searches cached spaces by title with filters", () => {
    let record = createEmptyCacheRecord(60_000);
    record = upsertCachedSpaces(record, [
      { id: "1", title: "[CLBR] EG CI 2026.1", type: "group", teamId: "team-a" },
      { id: "2", title: "Support", type: "direct" },
      { id: "3", title: "[CLBR] Other", type: "group", teamId: "team-b" },
    ]);

    const matches = searchCachedSpaces(record, {
      query: "EG CI 2026.1",
      type: "group",
      teamId: "team-a",
      maxResults: 10,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.id, "1");
  });

  it("detects expired cache records", () => {
    const record = {
      ...createEmptyCacheRecord(60_000),
      syncedAt: new Date(Date.now() - 120_000).toISOString(),
    };

    assert.equal(isCacheExpired(record), true);
    assert.equal(isCacheExpired({ ...record, syncedAt: new Date().toISOString() }), false);
  });

  it("merges cache and api results without duplicates", () => {
    const merged = mergeCachedSpaces(
      [{ id: "1", title: "Alpha" }],
      [
        { id: "1", title: "Alpha duplicate" },
        { id: "2", title: "Beta" },
      ],
      10
    );

    assert.deepEqual(
      merged.map((space) => space.id),
      ["1", "2"]
    );
  });

  it("replaces cache on full sync", () => {
    let record = upsertCachedSpaces(createEmptyCacheRecord(60_000), [
      { id: "old", title: "Old room" },
    ]);

    record = replaceCachedSpaces(
      record,
      [{ id: "new", title: "New room" }],
      true
    );

    assert.equal(record.complete, true);
    assert.deepEqual(Object.keys(record.spaces), ["new"]);
  });
});
