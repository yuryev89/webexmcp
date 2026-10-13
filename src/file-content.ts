import { getApiBaseUrl } from "./auth/config.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

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
  return value && value.length > 0 ? value : undefined;
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
