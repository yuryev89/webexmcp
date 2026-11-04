import { getApiBaseUrl } from "./auth/config.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Webex rejects message attachments above 100 MB, so nothing bigger can be saved. */
export const MAX_SAVE_BYTES = 100 * 1024 * 1024;

const VISION_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export type FileDetails = {
  url: string;
  contentType: string;
  filename?: string;
  contentLength?: number;
};

export type DownloadedFile = FileDetails & {
  size: number;
  base64: string;
};

export function normalizeContentType(header: string | null | undefined): string {
  if (!header) {
    return "application/octet-stream";
  }
  const type = header.split(";")[0]?.trim().toLowerCase();
  return type && type.length > 0 ? type : "application/octet-stream";
}

export function parseContentDispositionFilename(
  header: string | null | undefined
): string | undefined {
  if (!header) {
    return undefined;
  }

  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star?.[1]) {
    const raw = star[1].trim().replace(/^["']|["']$/g, "");
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const plain = /filename=(?:["']([^"']+)["']|([^;]+))/i.exec(header);
  const value = plain?.[1] ?? plain?.[2]?.trim();
  return value && value.length > 0 ? decodeFormEncodedFilename(value) : undefined;
}

/**
 * Webex sends the plain `filename=` parameter form-encoded
 * (`RDB+Data+Model+%28v1%29.xlsx`), so `+` is a space and `%XX` an escape.
 */
export function decodeFormEncodedFilename(value: string): string {
  const spaced = value.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_FILENAME_LENGTH = 180;

/** Make a server-provided filename safe to use as a single path segment. */
export function sanitizeFilename(name: string | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  let safe = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim();
  if (safe === "" || /^\.+$/.test(safe)) {
    safe = "attachment";
  }
  if (WINDOWS_RESERVED.test(safe)) {
    safe = `_${safe}`;
  }
  if (safe.length > MAX_FILENAME_LENGTH) {
    const dot = safe.lastIndexOf(".");
    const ext = dot > 0 && safe.length - dot <= 16 ? safe.slice(dot) : "";
    safe = safe.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
  }
  return safe;
}

/** Append ` (n)` before the extension until the name is not in `taken` (case-insensitive). */
export function uniqueFilename(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) {
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
}

export type FileKind = "image" | "text" | "archive" | "binary";

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/sql",
  "application/x-sql",
  "application/x-sh",
  "application/x-yaml",
  "application/yaml",
  "application/x-patch",
  "application/x-diff",
  "application/csv",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "log", "md", "csv", "tsv", "json", "xml", "yaml", "yml", "sql",
  "diff", "patch", "java", "js", "ts", "py", "sh", "bat", "ps1", "properties",
  "jsp", "html", "htm", "css", "ini", "cfg", "conf", "toml", "gradle", "kt",
  "go", "c", "h", "cpp", "cs", "rb", "pl", "xsd", "wsdl", "xsl", "svg",
]);

const ARCHIVE_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/java-archive",
]);

const ARCHIVE_EXTENSIONS = new Set(["zip", "jar", "war", "ear"]);

function extensionOf(filename: string | undefined): string | undefined {
  if (!filename || !filename.includes(".")) {
    return undefined;
  }
  return filename.split(".").pop()?.toLowerCase();
}

/** Classify a file so the tools can pick how to hand it to the agent. */
export function classifyFile(contentType: string, filename?: string): FileKind {
  const type = resolveContentType(contentType, filename);
  const ext = extensionOf(filename);
  if (VISION_MIME_TYPES.has(type)) {
    return "image";
  }
  if (ARCHIVE_MIME_TYPES.has(type) || (ext !== undefined && ARCHIVE_EXTENSIONS.has(ext))) {
    return "archive";
  }
  if (
    type.startsWith("text/") ||
    TEXT_MIME_TYPES.has(type) ||
    type.endsWith("+json") ||
    type.endsWith("+xml") ||
    (ext !== undefined && TEXT_EXTENSIONS.has(ext))
  ) {
    return "text";
  }
  return "binary";
}

function hasUtf16Bom(buffer: Buffer): boolean {
  return (
    buffer.length >= 2 &&
    ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))
  );
}

/** NUL bytes in the first 8 KB mean binary content, whatever the Content-Type claims. */
export function looksBinary(buffer: Buffer): boolean {
  if (hasUtf16Bom(buffer)) {
    return false;
  }
  return buffer.subarray(0, 8192).includes(0);
}

/** Decode text honouring UTF-8 / UTF-16 byte-order marks; UTF-8 otherwise. */
export function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer.subarray(2));
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer.subarray(2));
  }
  return new TextDecoder("utf-8").decode(buffer);
}

export type TextSlice = {
  totalChars: number;
  offset: number;
  returnedChars: number;
  truncated: boolean;
  nextOffset?: number;
  text: string;
};

export const DEFAULT_TEXT_CHARS = 50_000;

export function sliceText(text: string, offset = 0, maxChars = DEFAULT_TEXT_CHARS): TextSlice {
  const start = Math.min(Math.max(offset, 0), text.length);
  const chunk = text.slice(start, start + maxChars);
  const end = start + chunk.length;
  const slice: TextSlice = {
    totalChars: text.length,
    offset: start,
    returnedChars: chunk.length,
    truncated: end < text.length,
    text: chunk,
  };
  if (end < text.length) slice.nextOffset = end;
  return slice;
}

export type ArchiveEntry = {
  name: string;
  size: number;
  compressedSize: number;
  directory: boolean;
  encrypted: boolean;
};

export type ArchiveListing = {
  totalEntries: number;
  totalUncompressedSize: number;
  entries: ArchiveEntry[];
  truncated: boolean;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_SIZE = 22;

/**
 * List a ZIP/JAR central directory without extracting anything.
 * ZIP64 archives are rejected; the caller can still save them to disk.
 */
export function listZipEntries(buffer: Buffer, maxEntries = 500): ArchiveListing {
  const searchFrom = Math.max(0, buffer.length - 0xffff - EOCD_MIN_SIZE);
  let eocd = -1;
  for (let i = buffer.length - EOCD_MIN_SIZE; i >= searchFrom; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("Not a ZIP archive (end of central directory not found)");
  }

  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported for listing");
  }

  const entries: ArchiveEntry[] = [];
  let totalUncompressedSize = 0;
  let pos = cdOffset;
  for (let n = 0; n < totalEntries; n += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error("Corrupt ZIP central directory");
    }
    const flags = buffer.readUInt16LE(pos + 8);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const name = buffer
      .subarray(pos + 46, pos + 46 + nameLength)
      .toString(flags & 0x0800 ? "utf8" : "latin1");
    totalUncompressedSize += size;
    if (entries.length < maxEntries) {
      entries.push({
        name,
        size,
        compressedSize,
        directory: name.endsWith("/"),
        encrypted: (flags & 0x0001) !== 0,
      });
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }

  return {
    totalEntries,
    totalUncompressedSize,
    entries,
    truncated: totalEntries > entries.length,
  };
}

function uuidFromSparkId(id: string, kind: "CONTENT" | "MESSAGE"): string | undefined {
  const decoded = Buffer.from(id.trim(), "base64url").toString("utf8");
  const match = new RegExp(`/${kind}/([0-9a-f-]{36})(?:/|$)`, "i").exec(decoded);
  return match?.[1]?.toLowerCase();
}

/**
 * Webex contents ids are base64 of `ciscospark://<region>/CONTENT/<messageUuid>/<index>`,
 * so every file of one message maps to the same UUID.
 */
export function messageUuidFromContentsUrl(fileUrl: string): string | undefined {
  const id = fileUrl.trim().split("?")[0]?.split("/").pop();
  return id ? uuidFromSparkId(id, "CONTENT") : undefined;
}

/** Message ids are base64 of `ciscospark://<region>/MESSAGE/<uuid>`. */
export function uuidFromMessageId(messageId: string): string | undefined {
  return uuidFromSparkId(messageId, "MESSAGE");
}

export function mimeFromFilename(filename: string | undefined): string | undefined {
  if (!filename) {
    return undefined;
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) {
    return undefined;
  }
  return EXTENSION_MIME_TYPES[ext];
}

export function resolveContentType(
  contentTypeHeader: string | null | undefined,
  filename?: string
): string {
  const fromHeader = normalizeContentType(contentTypeHeader);
  if (fromHeader !== "application/octet-stream") {
    return fromHeader;
  }
  return mimeFromFilename(filename) ?? fromHeader;
}

export function isVisionImage(contentType: string, filename?: string): boolean {
  const resolved = resolveContentType(contentType, filename);
  return VISION_MIME_TYPES.has(resolved);
}

export function resolveContentsUrl(fileUrlOrId: string, fedramp = false): string {
  const trimmed = fileUrlOrId.trim();
  if (!trimmed) {
    throw new Error("fileUrl is required");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    assertWebexContentsUrl(trimmed);
    return trimmed;
  }

  return `${getApiBaseUrl(fedramp)}/v1/contents/${encodeURIComponent(trimmed)}`;
}

export function assertWebexContentsUrl(fileUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(fileUrl);
  } catch {
    throw new Error("Invalid file URL");
  }

  const hostOk =
    parsed.hostname === "webexapis.com" || parsed.hostname === "webexapis.us";
  if (
    parsed.protocol !== "https:" ||
    !hostOk ||
    !parsed.pathname.startsWith("/v1/contents/")
  ) {
    throw new Error(
      "fileUrl must be a Webex contents URL from a message files[] array"
    );
  }
  return parsed;
}

export function detailsFromHeaders(url: string, headers: Headers): FileDetails {
  const filename = parseContentDispositionFilename(
    headers.get("content-disposition")
  );
  const contentType = resolveContentType(headers.get("content-type"), filename);
  const lengthHeader = headers.get("content-length");
  const contentLength = lengthHeader ? Number.parseInt(lengthHeader, 10) : Number.NaN;

  const details: FileDetails = { url, contentType };
  if (filename) details.filename = filename;
  if (Number.isFinite(contentLength) && contentLength >= 0) {
    details.contentLength = contentLength;
  }
  return details;
}

export function assertWithinSizeLimit(
  contentLength: number | undefined,
  maxBytes = MAX_FILE_BYTES
): void {
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw new Error(`File exceeds ${maxBytes} byte download limit`);
  }
}
