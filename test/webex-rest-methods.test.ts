import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { createWebexClient } from "../src/webex.js";

function mockResponse(
  status: number,
  body: unknown,
  statusText = "OK",
  headers?: Record<string, string>,
  binary?: Buffer
) {
  const encoded =
    binary ?? Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => (binary ? encoded.toString("utf8") : JSON.stringify(body)),
    arrayBuffer: async () =>
      encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
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

  it("downloadFile delegates to contents GET", async () => {
    const png = Buffer.from("png-bytes");
    fetchMock.mock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      assert.equal(String(url), "https://webexapis.com/v1/contents/abc");
      assert.equal(init?.method, "GET");
      return mockResponse(
        200,
        null,
        "OK",
        { "content-type": "image/png" },
        png
      );
    });

    const client = createWebexClient({ token: "token" });
    const file = await client.downloadFile("https://webexapis.com/v1/contents/abc");
    assert.equal(file.contentType, "image/png");
    assert.equal(file.base64, png.toString("base64"));
  });
});
