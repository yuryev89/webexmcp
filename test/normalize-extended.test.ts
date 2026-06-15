import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeAttachmentAction,
  normalizeTeam,
  normalizeTeamMembership,
  normalizeWebhook,
} from "../src/normalize.js";

describe("normalize extended types", () => {
  it("normalizeTeam picks expected fields", () => {
    const result = normalizeTeam({
      id: "team-1",
      name: "Engineering",
      description: "Eng team",
      created: "2024-01-01T00:00:00.000Z",
    });

    assert.deepEqual(result, {
      id: "team-1",
      name: "Engineering",
      description: "Eng team",
      created: "2024-01-01T00:00:00.000Z",
    });
  });

  it("normalizeTeamMembership picks expected fields", () => {
    const result = normalizeTeamMembership({
      id: "tm-1",
      teamId: "team-1",
      personId: "person-1",
      personEmail: "alice@example.com",
      personDisplayName: "Alice",
      isModerator: true,
      created: "2024-01-01T00:00:00.000Z",
    });

    assert.equal(result.personDisplayName, "Alice");
    assert.equal(result.isModerator, true);
  });

  it("normalizeWebhook picks expected fields", () => {
    const result = normalizeWebhook({
      id: "wh-1",
      name: "Message webhook",
      targetUrl: "https://example.com/hook",
      resource: "messages",
      event: "created",
      filter: "roomId=room-1",
      created: "2024-01-01T00:00:00.000Z",
      status: "active",
      secret: "should-not-leak",
    });

    assert.equal(result.name, "Message webhook");
    assert.equal(result.resource, "messages");
    assert.equal((result as { secret?: string }).secret, undefined);
  });

  it("normalizeAttachmentAction picks expected fields", () => {
    const result = normalizeAttachmentAction({
      id: "aa-1",
      messageId: "msg-1",
      type: "submit",
      inputs: { field: "value" },
      personId: "person-1",
      roomId: "room-1",
      created: "2024-01-01T00:00:00.000Z",
    });

    assert.deepEqual(result.inputs, { field: "value" });
    assert.equal(result.type, "submit");
  });
});
