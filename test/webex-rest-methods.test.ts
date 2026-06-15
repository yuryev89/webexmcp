import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { createWebexClient } from "../src/webex.js";

function mockResponse(status: number, body: unknown, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("webex client REST-backed methods", () => {
  let fetchMock: ReturnType<typeof mock.fn>;

  before(() => {
    fetchMock = mock.fn();
    mock.method(globalThis, "fetch", fetchMock);
  });

  after(() => {
    mock.restoreAll();
  });

  it("listDirectMessages normalizes REST response", async () => {
    fetchMock.mock.mockImplementation(async (url: string | URL) => {
      const parsed = new URL(String(url));
      assert.equal(parsed.pathname, "/v1/messages/direct");
      return mockResponse(200, {
        items: [
          {
            id: "msg-1",
            text: "hello",
            roomId: "room-1",
            created: "2024-01-01T00:00:00.000Z",
          },
        ],
      });
    });

    const client = createWebexClient({ token: "token" });
    const result = await client.listDirectMessages({ personEmail: "alice@example.com" });
    assert.equal(result.total, 1);
    assert.equal(result.messages[0]?.text, "hello");
  });

  it("getSpaceMeetingInfo delegates to REST client", async () => {
    fetchMock.mock.mockImplementation(async () =>
      mockResponse(200, { sipAddress: "sip@example.com", meetingNumber: "123" })
    );

    const client = createWebexClient({ token: "token" });
    const result = await client.getSpaceMeetingInfo("room-1");
    assert.equal(result.sipAddress, "sip@example.com");
  });
});
