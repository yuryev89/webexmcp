import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_FILE_BYTES,
  assertWebexContentsUrl,
  assertWithinSizeLimit,
  detailsFromHeaders,
  isVisionImage,
  normalizeContentType,
  parseContentDispositionFilename,
  resolveContentsUrl,
  resolveContentType,
} from "../src/file-content.js";

describe("file-content helpers", () => {
  it("normalizeContentType strips parameters", () => {
    assert.equal(normalizeContentType("image/png; charset=binary"), "image/png");
    assert.equal(normalizeContentType(""), "application/octet-stream");
    assert.equal(normalizeContentType(undefined), "application/octet-stream");
  });

  it("parseContentDispositionFilename reads quoted and RFC 5987 names", () => {
    assert.equal(
      parseContentDispositionFilename('attachment; filename="shot.png"'),
      "shot.png"
    );
    assert.equal(
      parseContentDispositionFilename("attachment; filename*=UTF-8''caf%C3%A9.gif"),
      "café.gif"
    );
    assert.equal(parseContentDispositionFilename(null), undefined);
  });

  it("resolveContentType falls back to filename extension", () => {
    assert.equal(resolveContentType("image/jpeg"), "image/jpeg");
    assert.equal(
      resolveContentType("application/octet-stream", "diagram.webp"),
      "image/webp"
    );
  });

  it("isVisionImage accepts PNG/JPEG/GIF/WebP only", () => {
    assert.equal(isVisionImage("image/png"), true);
    assert.equal(isVisionImage("image/jpeg", "x.jpg"), true);
    assert.equal(isVisionImage("application/octet-stream", "x.gif"), true);
    assert.equal(isVisionImage("application/pdf", "doc.pdf"), false);
    assert.equal(isVisionImage("image/svg+xml", "icon.svg"), false);
  });

  it("assertWebexContentsUrl rejects non-contents hosts", () => {
    assert.doesNotThrow(() =>
      assertWebexContentsUrl("https://webexapis.com/v1/contents/abc")
    );
    assert.throws(
      () => assertWebexContentsUrl("https://evil.example/v1/contents/abc"),
      /contents URL/
    );
    assert.throws(
      () => assertWebexContentsUrl("https://webexapis.com/v1/messages/abc"),
      /contents URL/
    );
  });

  it("resolveContentsUrl accepts ids and full URLs", () => {
    assert.equal(
      resolveContentsUrl("https://webexapis.com/v1/contents/abc"),
      "https://webexapis.com/v1/contents/abc"
    );
    assert.equal(
      resolveContentsUrl("content-id-1"),
      "https://webexapis.com/v1/contents/content-id-1"
    );
  });

  it("assertWithinSizeLimit rejects oversized files", () => {
    assert.doesNotThrow(() => assertWithinSizeLimit(100));
    assert.throws(
      () => assertWithinSizeLimit(MAX_FILE_BYTES + 1),
      /download limit/
    );
  });

  it("detailsFromHeaders maps response headers", () => {
    const headers = new Headers({
      "content-type": "image/png",
      "content-length": "42",
      "content-disposition": 'attachment; filename="a.png"',
    });
    const details = detailsFromHeaders(
      "https://webexapis.com/v1/contents/abc",
      headers
    );
    assert.equal(details.filename, "a.png");
    assert.equal(details.contentType, "image/png");
    assert.equal(details.contentLength, 42);
  });
});
