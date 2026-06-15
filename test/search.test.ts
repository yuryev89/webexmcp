import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeMembership,
  normalizeMessage,
  normalizePerson,
  normalizeSpace,
} from "../src/normalize.js";
import { matchesMessageText, matchesSpaceTitle } from "../src/search.js";

describe("normalize", () => {
  it("normalizeSpace picks expected fields", () => {
    const result = normalizeSpace({
      id: "room-1",
      title: "Project Alpha",
      type: "group",
      isLocked: false,
      lastActivity: "2024-01-01T00:00:00.000Z",
      creatorId: "creator-1",
      created: "2023-01-01T00:00:00.000Z",
      description: "ignored",
    });

    assert.deepEqual(result, {
      id: "room-1",
      title: "Project Alpha",
      type: "group",
      isLocked: false,
      lastActivity: "2024-01-01T00:00:00.000Z",
      creatorId: "creator-1",
      created: "2023-01-01T00:00:00.000Z",
    });
  });

  it("normalizeMessage picks expected fields", () => {
    const result = normalizeMessage({
      id: "msg-1",
      roomId: "room-1",
      personEmail: "alice@example.com",
      text: "hello",
      markdown: "**hello**",
      created: "2024-01-01T00:00:00.000Z",
      parentId: "parent-1",
      files: ["https://example.com/file.png"],
    });

    assert.equal(result.id, "msg-1");
    assert.equal(result.text, "hello");
    assert.deepEqual(result.files, ["https://example.com/file.png"]);
  });

  it("normalizePerson picks expected fields", () => {
    const result = normalizePerson({
      id: "person-1",
      displayName: "Alice",
      emails: ["alice@example.com"],
      firstName: "Alice",
      lastName: "Smith",
      avatar: "https://example.com/a.png",
      status: "active",
    });

    assert.equal(result.displayName, "Alice");
    assert.deepEqual(result.emails, ["alice@example.com"]);
  });

  it("normalizeMembership picks expected fields", () => {
    const result = normalizeMembership({
      id: "membership-1",
      roomId: "room-1",
      personId: "person-1",
      personEmail: "alice@example.com",
      isModerator: true,
      created: "2024-01-01T00:00:00.000Z",
    });

    assert.equal(result.roomId, "room-1");
    assert.equal(result.isModerator, true);
  });
});

describe("search helpers", () => {
  it("matchesSpaceTitle is case-insensitive", () => {
    assert.equal(matchesSpaceTitle({ title: "Project Alpha" }, "alpha"), true);
    assert.equal(matchesSpaceTitle({ title: "Support Team" }, "support"), true);
    assert.equal(matchesSpaceTitle({ title: "Support Team" }, "sales"), false);
  });

  it("matchesSpaceTitle ignores empty query", () => {
    assert.equal(matchesSpaceTitle({ title: "Project Alpha" }, ""), false);
    assert.equal(matchesSpaceTitle({ title: "Project Alpha" }, "   "), false);
  });

  it("matchesSpaceTitle handles missing title", () => {
    assert.equal(matchesSpaceTitle({}, "alpha"), false);
  });

  it("matchesMessageText searches text and markdown", () => {
    assert.equal(matchesMessageText({ text: "deploy finished" }, "deploy"), true);
    assert.equal(matchesMessageText({ markdown: "**deploy** finished" }, "deploy"), true);
    assert.equal(matchesMessageText({ text: "all good" }, "deploy"), false);
  });
});
