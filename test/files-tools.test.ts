import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageResult, jsonResult } from "../src/tools/common.js";
import { isVisionImage } from "../src/file-content.js";

describe("file tool result shaping", () => {
  it("jsonResult stays text-only", () => {
    const result = jsonResult({ ok: true });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0]?.type, "text");
  });

  it("imageResult prepends a JSON summary then ImageContent", () => {
    const result = imageResult(
      { images: 1, skipped: [] },
      [{ mimeType: "image/png", data: "QQ==" }]
    );
    assert.equal(result.content[0]?.type, "text");
    assert.equal(result.content[1]?.type, "image");
    assert.equal(result.content[1]?.mimeType, "image/png");
    assert.equal(result.content[1]?.data, "QQ==");
    const summary = JSON.parse(result.content[0]?.text ?? "{}") as { images: number };
    assert.equal(summary.images, 1);
  });

  it("non-images are not treated as vision content", () => {
    assert.equal(isVisionImage("application/pdf", "notes.pdf"), false);
  });
});
