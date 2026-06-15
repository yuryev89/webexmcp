import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateDirectMessageParams,
  validateUpdateMessageParams,
} from "../src/tools/messages.js";
import { validateMembershipInvite } from "../src/tools/memberships.js";
import { validatePeopleSearch } from "../src/tools/people.js";
import { validateCreateWebhook } from "../src/tools/webhooks.js";

describe("tool validation helpers", () => {
  it("validateDirectMessageParams requires personId or personEmail", () => {
    assert.throws(
      () => validateDirectMessageParams({}),
      /personId or personEmail/
    );
    assert.doesNotThrow(() =>
      validateDirectMessageParams({ personId: "person-1" })
    );
  });

  it("validateUpdateMessageParams requires text or markdown", () => {
    assert.throws(
      () => validateUpdateMessageParams({ messageId: "msg-1" }),
      /text or markdown/
    );
    assert.doesNotThrow(() =>
      validateUpdateMessageParams({ messageId: "msg-1", text: "updated" })
    );
  });

  it("validateMembershipInvite requires personEmail or personId", () => {
    assert.throws(() => validateMembershipInvite({}), /personEmail or personId/);
    assert.doesNotThrow(() =>
      validateMembershipInvite({ personEmail: "alice@example.com" })
    );
  });

  it("validatePeopleSearch requires at least one filter", () => {
    assert.throws(() => validatePeopleSearch({}), /email, displayName, or id/);
    assert.doesNotThrow(() => validatePeopleSearch({ email: "alice@example.com" }));
  });

  it("validateCreateWebhook requires core fields", () => {
    assert.throws(
      () =>
        validateCreateWebhook({
          name: "",
          targetUrl: "https://example.com",
          resource: "messages",
          event: "created",
        }),
      /required/
    );
    assert.doesNotThrow(() =>
      validateCreateWebhook({
        name: "hook",
        targetUrl: "https://example.com",
        resource: "messages",
        event: "created",
      })
    );
  });
});
