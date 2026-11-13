import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import {
  classifyFile,
  decodeText,
  listZipEntries,
  looksBinary,
  messageUuidFromContentsUrl,
  parseContentDispositionFilename,
  sanitizeFilename,
  sliceText,
  uniqueFilename,
  uuidFromMessageId,
  type DownloadedFile,
} from "../src/file-content.js";
import { createRestClient } from "../src/rest-client.js";
import { downloadResult } from "../src/tools/files.js";
import { createWebexClient } from "../src/webex.js";


// Real ids taken from a Webex 1:1 room: CONTENT/<message uuid>/0 and MESSAGE/<same uuid>.
const MESSAGE_UUID = "fde23510-d836-11f1-8828-6705dae407fb";
const CONTENTS_URL =
  "https://webexapis.com/v1/contents/Y2lzY29zcGFyazovL3VzL0NPTlRFTlQvZmRlMjM1MTAtZDgzNi0xMWYxLTg4MjgtNjcwNWRhZTQwN2ZiLzA";
const MESSAGE_ID =
  "Y2lzY29zcGFyazovL3VzL01FU1NBR0UvZmRlMjM1MTAtZDgzNi0xMWYxLTg4MjgtNjcwNWRhZTQwN2Zi";
const SECOND_CONTENTS_URL = `https://webexapis.com/v1/contents/${Buffer.from(
  `ciscospark://us/CONTENT/${MESSAGE_UUID}/1`
).toString("base64url")}`;

/** Build a ZIP with stored (uncompressed) entries. */
function makeZip(entries: Array<{ name: string; data: string; flags?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data, "utf8");
    const flags = entry.flags ?? 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function downloaded(body: Buffer, contentType: string, filename: string): DownloadedFile {
  return {
    url: CONTENTS_URL,
    contentType,
    filename,
    size: body.length,
    base64: body.toString("base64"),
  };
}

function fileResponse(body: Buffer | string, headers: Record<string, string>, status = 200) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    status,
    headers,
  });
}

describe("attachment filename handling", () => {
  it("decodes the form-encoded filename Webex sends", () => {
    assert.equal(
      parseContentDispositionFilename(
        'attachment; filename="RDB+Data+Model+v+1.1+%28updated%29.xlsx"'
      ),
      "RDB Data Model v 1.1 (updated).xlsx"
    );
    assert.equal(
      parseContentDispositionFilename('attachment; filename="%5BCYTABOSS-377%5D.docx"'),
      "[CYTABOSS-377].docx"
    );
    assert.equal(
      parseContentDispositionFilename('attachment; filename="100%+sure.txt"'),
      "100% sure.txt"
    );
  });

  it("sanitizes names into a single safe path segment", () => {
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
    assert.equal(sanitizeFilename("..\\..\\boot.ini"), "boot.ini");
    assert.equal(sanitizeFilename("a<b>:c|d?.txt"), "a_b__c_d_.txt");
    assert.equal(sanitizeFilename("CON.txt"), "_CON.txt");
    assert.equal(sanitizeFilename("report. "), "report");
    assert.equal(sanitizeFilename(".."), "attachment");
    assert.equal(sanitizeFilename(undefined), "attachment");
    const long = sanitizeFilename(`${"x".repeat(300)}.xlsx`);
    assert.equal(long.length, 180);
    assert.ok(long.endsWith(".xlsx"));
  });

  it("uniqueFilename suffixes before the extension, case-insensitively", () => {
    const taken = new Set(["shot.png", "shot (1).png"]);
    assert.equal(uniqueFilename("Shot.png", taken), "Shot (2).png");
    assert.equal(uniqueFilename("other.png", taken), "other.png");
  });

  it("maps contents URLs and message ids to the same message UUID", () => {
    assert.equal(messageUuidFromContentsUrl(CONTENTS_URL), MESSAGE_UUID);
    assert.equal(messageUuidFromContentsUrl(SECOND_CONTENTS_URL), MESSAGE_UUID);
    assert.equal(uuidFromMessageId(MESSAGE_ID), MESSAGE_UUID);
    assert.equal(messageUuidFromContentsUrl("https://webexapis.com/v1/contents/abc"), undefined);
  });
});

describe("attachment content helpers", () => {
  it("classifies the attachment types seen in real chats", () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    assert.equal(classifyFile(xlsx, "model.xlsx"), "binary");
    assert.equal(classifyFile("application/pdf", "report.pdf"), "binary");
    assert.equal(classifyFile("application/java-archive", "lib.jar"), "archive");
    assert.equal(classifyFile("application/x-zip-compressed", "patch.zip"), "archive");
    assert.equal(classifyFile("text/plain", "db150.jsp"), "text");
    assert.equal(classifyFile("application/xml", "grants.xml"), "text");
    assert.equal(classifyFile("application/json", "resume.json"), "text");
    assert.equal(classifyFile("application/octet-stream", "fix.sql"), "text");
    assert.equal(classifyFile("image/png", "color.png"), "image");
  });

  it("detects binary bodies and decodes BOM-marked text", () => {
    assert.equal(looksBinary(Buffer.from("plain text")), false);
    assert.equal(looksBinary(Buffer.from([0x50, 0x4b, 0x00, 0x01])), true);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("héllo", "utf16le")]);
    assert.equal(looksBinary(utf16), false);
    assert.equal(decodeText(utf16), "héllo");
    assert.equal(decodeText(Buffer.from("﻿abc", "utf8")), "abc");
  });

  it("sliceText pages through long text", () => {
    const first = sliceText("abcdefghij", 0, 4);
    assert.deepEqual(
      { text: first.text, truncated: first.truncated, nextOffset: first.nextOffset },
      { text: "abcd", truncated: true, nextOffset: 4 }
    );
    const last = sliceText("abcdefghij", 8, 4);
    assert.equal(last.text, "ij");
    assert.equal(last.truncated, false);
    assert.equal(last.nextOffset, undefined);
    assert.equal(sliceText("abc", 99, 4).text, "");
  });

  it("listZipEntries reads the central directory without extracting", () => {
    const zip = makeZip([
      { name: "DF_CYTABOSS-29189_V1.sql", data: "select 1 from dual;" },
      { name: "sub/", data: "" },
      { name: "secret.txt", data: "x", flags: 0x0001 },
    ]);
    const listing = listZipEntries(zip);
    assert.equal(listing.totalEntries, 3);
    assert.equal(listing.entries[0]?.name, "DF_CYTABOSS-29189_V1.sql");
    assert.equal(listing.entries[0]?.size, 19);
    assert.equal(listing.entries[1]?.directory, true);
    assert.equal(listing.entries[2]?.encrypted, true);
    assert.equal(listing.totalUncompressedSize, 20);

    const capped = listZipEntries(zip, 1);
    assert.equal(capped.entries.length, 1);
    assert.equal(capped.truncated, true);

    assert.throws(() => listZipEntries(Buffer.from("not a zip at all, definitely")), /Not a ZIP/);
  });
});

describe("webex_download_file result shaping", () => {
  it("returns text files as a paged text part after the summary", () => {
    const result = downloadResult(
      downloaded(Buffer.from("line1\nline2\nline3"), "text/plain", "HF_42811.sql"),
      { offset: 0, maxChars: 6 }
    );
    assert.equal(result.content.length, 2);
    const summary = JSON.parse(result.content[0]?.text ?? "{}");
    assert.equal(summary.kind, "text");
    assert.equal(summary.totalChars, 17);
    assert.equal(summary.nextOffset, 6);
    assert.equal(result.content[1]?.text, "line1\n");
  });

  it("lists archive entries instead of inlining the body", () => {
    const zip = makeZip([{ name: "Instruction.txt", data: "run me" }]);
    const result = downloadResult(downloaded(zip, "application/x-zip-compressed", "p.zip"));
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    assert.equal(body.kind, "archive");
    assert.equal(body.archive.entries[0].name, "Instruction.txt");
  });

  it("treats NUL-containing text/plain bodies as binary and points to save", () => {
    const result = downloadResult(
      downloaded(Buffer.from([0x41, 0x00, 0x42]), "text/plain", "weird.txt")
    );
    const body = JSON.parse(result.content[0]?.text ?? "{}");
    assert.equal(body.kind, "binary");
    assert.match(body.note, /webex_save_file/);
  });

  it("keeps images inline for vision", () => {
    const result = downloadResult(downloaded(Buffer.from([0x89, 0x50]), "image/png", "a.png"));
    assert.equal(result.content[1]?.type, "image");
  });
});

describe("rest-client saveContents", () => {
  let directory: string;
  let fetchMock: ReturnType<typeof mock.fn>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "webex-save-"));
    fetchMock = mock.fn();
    mock.method(globalThis, "fetch", fetchMock);
  });

  afterEach(async () => {
    mock.restoreAll();
    await rm(directory, { recursive: true, force: true });
  });

  it("streams the body to disk and reports size and sha256", async () => {
    const body = Buffer.from("select * from nc_objects where rownum < 2;");
    fetchMock.mock.mockImplementation(async () =>
      fileResponse(body, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="HF_CYTABOSS-42811_02.sql"',
        "content-length": String(body.length),
      })
    );
    const client = createRestClient({ getAccessToken: () => "t" });
    const saved = await client.saveContents(CONTENTS_URL, (details) =>
      join(directory, details.filename ?? "x")
    );
    assert.equal(saved.path, join(directory, "HF_CYTABOSS-42811_02.sql"));
    assert.equal(saved.size, body.length);
    assert.equal(saved.sha256, createHash("sha256").update(body).digest("hex"));
    assert.deepEqual(await readFile(saved.path), body);
    assert.deepEqual(await readdir(directory), ["HF_CYTABOSS-42811_02.sql"]);
  });

  it("rejects an oversized chunked body and leaves no partial file", async () => {
    // Gzip-encoded JSON arrives chunked with no Content-Length, so the limit is enforced on bytes read.
    fetchMock.mock.mockImplementation(async () =>
      fileResponse("x".repeat(64), {
        "content-type": "application/json",
        "content-disposition": 'attachment; filename="big.json"',
      })
    );
    const client = createRestClient({ getAccessToken: () => "t" });
    await assert.rejects(
      () => client.saveContents(CONTENTS_URL, () => join(directory, "big.json"), 16),
      /download limit/
    );
    assert.deepEqual(await readdir(directory), []);
  });

  it("rejects by Content-Length before writing anything", async () => {
    fetchMock.mock.mockImplementation(async () =>
      fileResponse("", { "content-length": String(200 * 1024 * 1024) })
    );
    const client = createRestClient({ getAccessToken: () => "t" });
    let chooseCalled = false;
    await assert.rejects(
      () =>
        client.saveContents(CONTENTS_URL, () => {
          chooseCalled = true;
          return join(directory, "never");
        }),
      /download limit/
    );
    assert.equal(chooseCalled, false);
  });

  it("retries 423 Locked after Retry-After, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    fetchMock.mock.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return fileResponse("scanning", { "retry-after": "3" }, 423);
      }
      return fileResponse("ok", { "content-disposition": 'attachment; filename="a.txt"' });
    });
    const client = createRestClient({
      getAccessToken: () => "t",
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const saved = await client.saveContents(CONTENTS_URL, () => join(directory, "a.txt"));
    assert.equal(saved.size, 2);
    assert.deepEqual(waits, [3000]);
  });

  it("reports HTTP status when the file stays locked", async () => {
    fetchMock.mock.mockImplementation(async () => fileResponse("", {}, 423));
    const client = createRestClient({ getAccessToken: () => "t", sleep: async () => {} });
    await assert.rejects(
      () => client.getContents(CONTENTS_URL),
      /HTTP 423: file is still being scanned/
    );
    assert.equal(fetchMock.mock.calls.length, 4);
  });
});

describe("webex client save and file details", () => {
  let directory: string;
  let previousDir: string | undefined;
  let fetchMock: ReturnType<typeof mock.fn>;
  const bodies: Record<string, { name: string; type: string; data: string }> = {
    [CONTENTS_URL]: { name: "report.pdf", type: "application/pdf", data: "%PDF-1.5" },
    [SECOND_CONTENTS_URL]: { name: "report.pdf", type: "application/pdf", data: "%PDF-1.7" },
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "webex-client-save-"));
    previousDir = process.env.WEBEX_DOWNLOAD_DIR;
    process.env.WEBEX_DOWNLOAD_DIR = directory;
    fetchMock = mock.fn(async (url: string | URL) => {
      const message = String(url).match(/\/v1\/messages\/([^/?]+)$/);
      if (message) {
        return Response.json({
          id: decodeURIComponent(message[1]!),
          roomId: "room-1",
          files: [CONTENTS_URL, SECOND_CONTENTS_URL, "https://webexapis.com/v1/contents/missing"],
        });
      }
      const file = bodies[String(url)];
      if (!file) return fileResponse("not found", {}, 404);
      return fileResponse(file.data, {
        "content-type": file.type,
        "content-disposition": `attachment; filename="${file.name}"`,
        "content-length": String(file.data.length),
      });
    });
    mock.method(globalThis, "fetch", fetchMock);
  });

  afterEach(async () => {
    mock.restoreAll();
    if (previousDir === undefined) delete process.env.WEBEX_DOWNLOAD_DIR;
    else process.env.WEBEX_DOWNLOAD_DIR = previousDir;
    await rm(directory, { recursive: true, force: true });
  });

  it("saveFile writes into <downloadDir>/<messageUuid>/<filename>", async () => {
    const client = createWebexClient({ token: "t" });
    const saved = await client.saveFile(CONTENTS_URL);
    assert.equal(saved.path, join(directory, MESSAGE_UUID, "report.pdf"));
    assert.equal(saved.kind, "binary");
    assert.equal(await readFile(saved.path, "utf8"), "%PDF-1.5");
  });

  it("saveMessageFiles keeps same-named files apart and reports failures", async () => {
    const client = createWebexClient({ token: "t" });
    const result = await client.saveMessageFiles(MESSAGE_ID);
    assert.equal(result.directory, join(directory, MESSAGE_UUID));
    assert.deepEqual(
      result.saved.map((file) => file.path),
      [join(directory, MESSAGE_UUID, "report.pdf"), join(directory, MESSAGE_UUID, "report (1).pdf")]
    );
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0]?.error ?? "", /HTTP 404/);
  });

  it("addFileDetails annotates only messages that have files", async () => {
    const client = createWebexClient({ token: "t" });
    const messages = await client.addFileDetails([
      { id: "m1", text: "no files" },
      { id: "m2", files: [CONTENTS_URL] },
    ]);
    assert.equal("attachments" in (messages[0] ?? {}), false);
    const annotated = messages[1] as { attachments?: Array<Record<string, unknown>> };
    assert.equal(annotated.attachments?.[0]?.filename, "report.pdf");
    assert.equal(annotated.attachments?.[0]?.kind, "binary");
  });
});
