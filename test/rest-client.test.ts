import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { WebexApiError, createRestClient } from "../src/rest-client.js";

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

describe("rest-client", () => {
  let fetchMock: ReturnType<typeof mock.fn>;

  before(() => {
    fetchMock = mock.fn();
    mock.method(globalThis, "fetch", fetchMock);
  });

  beforeEach(() => {
    fetchMock.mock.resetCalls();
  });

  after(() => {
    mock.restoreAll();
  });

  it("getSpaceMeetingInfo calls correct URL with bearer token", async () => {
    fetchMock.mock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      assert.match(href, /\/v1\/rooms\/room-1\/meetingInfo$/);
      assert.equal(init?.method, "GET");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-token"
      );
      return mockResponse(200, { sipAddress: "sip@example.com" });
    });

    const client = createRestClient({ getAccessToken: () => "test-token" });
    const result = await client.getSpaceMeetingInfo("room-1");
    assert.equal(result.sipAddress, "sip@example.com");
  });

  it("listDirectMessages builds query params", async () => {
    fetchMock.mock.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      assert.equal(parsed.pathname, "/v1/messages/direct");
      assert.equal(parsed.searchParams.get("personEmail"), "alice@example.com");
      return mockResponse(200, { items: [{ id: "msg-1", text: "hi" }] });
    });

    const client = createRestClient({ getAccessToken: () => "test-token" });
    const result = await client.listDirectMessages({ personEmail: "alice@example.com" });
    assert.equal(result.items?.length, 1);
  });

  it("deleteTeam returns deleted on 204", async () => {
    fetchMock.mock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      assert.match(href, /\/v1\/teams\/team-1$/);
      assert.equal(init?.method, "DELETE");
      return mockResponse(204, null, "No Content");
    });

    const client = createRestClient({ getAccessToken: () => "test-token" });
    const result = await client.deleteTeam("team-1");
    assert.equal(result.deleted, true);
  });

  it("retries on 401 when refreshToken is provided", async () => {
    let call = 0;
    let token = "expired-token";
    fetchMock.mock.mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        return mockResponse(401, { message: "invalid token" }, "Unauthorized");
      }
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer refreshed-token"
      );
      return mockResponse(204, null, "No Content");
    });

    const client = createRestClient({
      getAccessToken: () => token,
      refreshToken: async () => {
        token = "refreshed-token";
      },
    });
    const result = await client.deleteTeam("team-1");
    assert.equal(result.deleted, true);
    assert.equal(fetchMock.mock.calls.length, 2);
  });

  it("throws parsed API error message", async () => {
    fetchMock.mock.mockImplementation(async () =>
      mockResponse(400, { message: "room not found" }, "Bad Request")
    );

    const client = createRestClient({ getAccessToken: () => "test-token" });
    await assert.rejects(
      () => client.getSpaceMeetingInfo("missing"),
      /room not found/
    );
  });

  it("headContents falls back to GET on 405", async () => {
    let call = 0;
    fetchMock.mock.mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      call += 1;
      if (call === 1) {
        assert.equal(init?.method, "HEAD");
        return mockResponse(405, { message: "Method Not Allowed" }, "Method Not Allowed");
      }
      assert.equal(init?.method, "GET");
      return mockResponse(200, null, "OK", {
        "content-type": "image/jpeg",
        "content-disposition": 'attachment; filename="a.jpg"',
      });
    });

    const client = createRestClient({ getAccessToken: () => "test-token" });
    const details = await client.headContents("https://webexapis.com/v1/contents/abc");
    assert.equal(details.contentType, "image/jpeg");
    assert.equal(details.filename, "a.jpg");
    assert.equal(call, 2);
  });

  it("headContents reads filename and content-type", async () => {
    fetchMock.mock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      assert.equal(String(url), "https://webexapis.com/v1/contents/abc");
      assert.equal(init?.method, "HEAD");
      return mockResponse(200, null, "OK", {
        "content-type": "image/png",
        "content-length": "12",
        "content-disposition": 'attachment; filename="shot.png"',
      });
    });

    const client = createRestClient({ getAccessToken: () => "test-token" });
    const details = await client.headContents(
      "https://webexapis.com/v1/contents/abc"
    );
    assert.equal(details.filename, "shot.png");
    assert.equal(details.contentType, "image/png");
    assert.equal(details.contentLength, 12);
  });

  it("getContents returns base64 body for images", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    fetchMock.mock.mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      assert.equal(init?.method, "GET");
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer test-token"
      );
      return mockResponse(
        200,
        null,
        "OK",
        {
          "content-type": "image/png",
          "content-disposition": 'attachment; filename="shot.png"',
        },
        png
      );
    });

    const client = createRestClient({ getAccessToken: () => "test-token" });
    const file = await client.getContents("https://webexapis.com/v1/contents/abc");
    assert.equal(file.filename, "shot.png");
    assert.equal(file.base64, png.toString("base64"));
    assert.equal(file.size, png.length);
  });

  it("getContents rejects non-contents URLs", async () => {
    const client = createRestClient({ getAccessToken: () => "test-token" });
    await assert.rejects(
      () => client.getContents("https://example.com/secret.png"),
      /contents URL/
    );
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it("getContents rejects oversized content-length", async () => {
    fetchMock.mock.mockImplementation(async () =>
      mockResponse(200, null, "OK", {
        "content-type": "image/png",
        "content-length": String(20 * 1024 * 1024),
      })
    );

    const client = createRestClient({ getAccessToken: () => "test-token" });
    await assert.rejects(
      () => client.getContents("https://webexapis.com/v1/contents/huge"),
      /download limit/
    );
  });
});

describe("rest-client request and list", () => {
  let fetchMock: ReturnType<typeof mock.fn>;
  let responses: Array<ReturnType<typeof mockResponse>>;
  let urls: string[];
  let auths: string[];

  before(() => {
    fetchMock = mock.fn(async (url: string | URL, init?: RequestInit) => {
      urls.push(String(url));
      auths.push((init?.headers as Record<string, string>).Authorization ?? "");
      const next = responses.shift();
      assert.ok(next, `unexpected fetch ${String(url)}`);
      return next;
    });
    mock.method(globalThis, "fetch", fetchMock);
  });

  beforeEach(() => {
    responses = [];
    urls = [];
    auths = [];
  });

  after(() => {
    mock.restoreAll();
  });

  it("request throws WebexApiError with statusCode", async () => {
    responses.push(
      mockResponse(404, { message: "Room not found" }, "Not Found", { trackingid: "T-1" })
    );
    const client = createRestClient({ getAccessToken: () => "t" });
    await assert.rejects(
      () => client.request("GET", "/rooms/x"),
      (err: unknown) => {
        assert.ok(err instanceof WebexApiError);
        assert.equal(err.statusCode, 404);
        assert.equal(err.message, "Room not found");
        assert.equal(err.trackingId, "T-1");
        return true;
      }
    );
  });

  // Review Focus 3
  it("request retries 429 using Retry-After", async () => {
    responses.push(
      mockResponse(429, { message: "slow down" }, "Too Many Requests", { "retry-after": "1" }),
      mockResponse(200, { id: "r1" })
    );
    const sleeps: number[] = [];
    const client = createRestClient({
      getAccessToken: () => "t",
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.deepEqual(await client.request("GET", "/rooms/r1"), { id: "r1" });
    assert.deepEqual(sleeps, [1000]);
    assert.equal(urls.length, 2);
  });

  it("request gives up after repeated 429s", async () => {
    for (let i = 0; i < 4; i += 1) {
      responses.push(
        mockResponse(429, { message: "slow down" }, "Too Many Requests", { "retry-after": "1" })
      );
    }
    const client = createRestClient({ getAccessToken: () => "t", sleep: async () => {} });
    await assert.rejects(
      () => client.request("GET", "/messages"),
      (err: unknown) => err instanceof WebexApiError && err.statusCode === 429
    );
  });

  // Review Focus 1
  it("list follows Link next verbatim", async () => {
    const nextUrl = "https://webexapis.com/v1/messages?roomId=R&max=1&beforeMessage=X";
    responses.push(
      mockResponse(200, { items: [{ id: "a" }] }, "OK", { link: `<${nextUrl}>; rel="next"` }),
      mockResponse(200, { items: [{ id: "b" }] })
    );
    const client = createRestClient({ getAccessToken: () => "t" });
    const page1 = await client.list<{ id: string }>("/messages", { roomId: "R", max: 1 });
    assert.deepEqual(page1.items, [{ id: "a" }]);
    assert.ok(page1.next);
    const page2 = await page1.next();
    assert.deepEqual(page2.items, [{ id: "b" }]);
    assert.equal(page2.next, undefined);
    assert.equal(urls[1], nextUrl);
  });

  // Review Focus 2
  it("list next refreshes token on 401", async () => {
    let token = "old";
    let refreshes = 0;
    responses.push(
      mockResponse(200, { items: [{ id: "a" }] }, "OK", {
        link: '<https://webexapis.com/v1/rooms?cursor=2>; rel="next"',
      }),
      mockResponse(401, { message: "token expired" }, "Unauthorized"),
      mockResponse(200, { items: [{ id: "b" }] })
    );
    const client = createRestClient({
      getAccessToken: () => token,
      refreshToken: async () => {
        refreshes += 1;
        token = "new";
        return token;
      },
    });
    const page1 = await client.list<{ id: string }>("/rooms");
    const page2 = await page1.next!();
    assert.deepEqual(page2.items, [{ id: "b" }]);
    assert.equal(refreshes, 1);
    assert.deepEqual(auths, ["Bearer old", "Bearer old", "Bearer new"]);
  });
});
