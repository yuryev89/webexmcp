import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesSpaceTitle, scanPagedMatches } from "../src/search.js";

type Item = { id: string; title: string };

function makePages(pages: Item[][]) {
  let index = 0;
  const fetchPage = async (): Promise<{
    items: Item[];
    next?: () => Promise<{ items: Item[]; next?: () => Promise<{ items: Item[] }> }>;
  }> => {
    const items = pages[index] ?? [];
    const current = index;
    index++;
    if (current < pages.length - 1) {
      return {
        items,
        next: fetchPage,
      };
    }
    return { items };
  };
  return fetchPage;
}

describe("scanPagedMatches", () => {
  it("collects matches across pages", async () => {
    const result = await scanPagedMatches({
      fetchFirstPage: makePages([
        [
          { id: "1", title: "Project Alpha" },
          { id: "2", title: "Support" },
        ],
        [
          { id: "3", title: "Alpha Beta" },
          { id: "4", title: "Random" },
        ],
      ]),
      matches: (item) => matchesSpaceTitle(item, "alpha"),
      maxResults: 10,
      scanLimit: 100,
    });

    assert.equal(result.matched.length, 2);
    assert.deepEqual(
      result.matched.map((item) => item.id),
      ["1", "3"]
    );
    assert.equal(result.scanned, 4);
    assert.equal(result.hasMore, false);
  });

  it("stops at maxResults", async () => {
    const result = await scanPagedMatches({
      fetchFirstPage: makePages([
        [
          { id: "1", title: "Alpha One" },
          { id: "2", title: "Alpha Two" },
          { id: "3", title: "Alpha Three" },
        ],
      ]),
      matches: (item) => matchesSpaceTitle(item, "alpha"),
      maxResults: 2,
      scanLimit: 100,
    });

    assert.equal(result.matched.length, 2);
    assert.equal(result.scanned, 2);
    assert.equal(result.hasMore, false);
  });

  it("stops at scanLimit", async () => {
    const result = await scanPagedMatches({
      fetchFirstPage: makePages([
        [
          { id: "1", title: "Alpha One" },
          { id: "2", title: "Beta" },
          { id: "3", title: "Alpha Three" },
        ],
      ]),
      matches: (item) => matchesSpaceTitle(item, "alpha"),
      maxResults: 10,
      scanLimit: 2,
    });

    assert.equal(result.matched.length, 1);
    assert.equal(result.scanned, 2);
    assert.equal(result.hasMore, false);
  });

  it("reports hasMore when more pages remain", async () => {
    const result = await scanPagedMatches({
      fetchFirstPage: makePages([
        [
          { id: "1", title: "Alpha One" },
          { id: "2", title: "Alpha Two" },
        ],
        [{ id: "3", title: "Alpha Three" }],
      ]),
      matches: (item) => matchesSpaceTitle(item, "alpha"),
      maxResults: 2,
      scanLimit: 100,
    });

    assert.equal(result.matched.length, 2);
    assert.equal(result.scanned, 2);
    assert.equal(result.hasMore, true);
  });
});
