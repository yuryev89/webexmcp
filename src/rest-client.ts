import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import { getApiBaseUrl } from "./auth/config.js";
import {
  MAX_FILE_BYTES,
  MAX_SAVE_BYTES,
  assertWithinSizeLimit,
  detailsFromHeaders,
  resolveContentsUrl,
  type DownloadedFile,
  type FileDetails,
} from "./file-content.js";

export type RestClientOpts = {
  getAccessToken: () => string;
  fedramp?: boolean;
  refreshToken?: () => Promise<string>;
  /** Injected in tests so 423 retries do not really wait. */
  sleep?: (ms: number) => Promise<void>;
};

type RequestOpts = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

function isAuthStatus(status: number): boolean {
  return status === 401;
}

async function parseErrorBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `HTTP ${response.status}: ${response.statusText}`;
  }

  try {
    const data = JSON.parse(text) as { message?: string; error?: string };
    return data.message ?? data.error ?? text;
  } catch {
    return text;
  }
}

export function createRestClient(opts: RestClientOpts) {
  function baseUrl(): string {
    return `${getApiBaseUrl(opts.fedramp ?? false)}/v1`;
  }

  async function request<T>(
    method: string,
    path: string,
    options: RequestOpts = {}
  ): Promise<T> {
    const url = new URL(`${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${opts.getAccessToken()}`,
    };

    const init: RequestInit = { method, headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }

    let response = await fetch(url, init);

    if (isAuthStatus(response.status) && opts.refreshToken) {
      await opts.refreshToken();
      headers.Authorization = `Bearer ${opts.getAccessToken()}`;
      response = await fetch(url, { ...init, headers });
    }

    if (!response.ok) {
      throw new Error(await parseErrorBody(response));
    }

    if (response.status === 204) {
      return { deleted: true } as T;
    }

    return (await response.json()) as T;
  }

  async function getSpaceMeetingInfo(roomId: string) {
    return request<Record<string, unknown>>(
      "GET",
      `/rooms/${encodeURIComponent(roomId)}/meetingInfo`
    );
  }

  async function listDirectMessages(params: {
    parentId?: string;
    personId?: string;
    personEmail?: string;
  }) {
    const query: Record<string, string | undefined> = {};
    if (params.parentId) query.parentId = params.parentId;
    if (params.personId) query.personId = params.personId;
    else if (params.personEmail) query.personEmail = params.personEmail;

    return request<{ items?: unknown[] }>("GET", "/messages/direct", { query });
  }

  async function deleteTeam(teamId: string) {
    return request<{ deleted: boolean }>("DELETE", `/teams/${encodeURIComponent(teamId)}`);
  }

  async function binaryRequest(method: "GET" | "HEAD", fileUrl: string): Promise<Response> {
    const url = resolveContentsUrl(fileUrl, opts.fedramp ?? false);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.getAccessToken()}`,
    };
    const init: RequestInit = { method, headers };
    let response = await fetch(url, init);

    if (isAuthStatus(response.status) && opts.refreshToken) {
      await opts.refreshToken();
      headers.Authorization = `Bearer ${opts.getAccessToken()}`;
      response = await fetch(url, { ...init, headers });
    }

    // 423 Locked: the file is still being scanned; wait as told and try again.
    for (let attempt = 0; response.status === 423 && attempt < LOCKED_RETRIES; attempt += 1) {
      await (opts.sleep ?? defaultSleep)(retryAfterMs(response.headers.get("retry-after")));
      response = await fetch(url, { ...init, headers });
    }

    return response;
  }

  async function contentsError(response: Response): Promise<Error> {
    const message = await parseErrorBody(response);
    if (response.status === 423) {
      return new Error(`HTTP 423: file is still being scanned by Webex, try again later (${message})`);
    }
    return new Error(message.startsWith("HTTP ") ? message : `HTTP ${response.status}: ${message}`);
  }

  async function headContents(fileUrl: string): Promise<FileDetails> {
    const url = resolveContentsUrl(fileUrl, opts.fedramp ?? false);
    let response = await binaryRequest("HEAD", fileUrl);
    if (response.status === 405) {
      response = await binaryRequest("GET", fileUrl);
    }
    if (!response.ok) {
      throw await contentsError(response);
    }
    return detailsFromHeaders(url, response.headers);
  }

  async function getContents(
    fileUrl: string,
    maxBytes = MAX_FILE_BYTES
  ): Promise<DownloadedFile> {
    const url = resolveContentsUrl(fileUrl, opts.fedramp ?? false);
    const response = await binaryRequest("GET", fileUrl);
    if (!response.ok) {
      throw await contentsError(response);
    }

    const details = detailsFromHeaders(url, response.headers);
    assertWithinSizeLimit(details.contentLength, maxBytes);

    const buffer = Buffer.from(await response.arrayBuffer());
    assertWithinSizeLimit(buffer.length, maxBytes);

    const downloaded: DownloadedFile = {
      ...details,
      size: buffer.length,
      base64: buffer.toString("base64"),
    };
    return downloaded;
  }

  /**
   * Stream a file to disk. `chooseTarget` gets the response metadata and returns the final path;
   * the body goes to `<target>.part` first and is renamed only once complete and within the limit.
   */
  async function saveContents(
    fileUrl: string,
    chooseTarget: (details: FileDetails) => string,
    maxBytes = MAX_SAVE_BYTES
  ): Promise<SavedFile> {
    const url = resolveContentsUrl(fileUrl, opts.fedramp ?? false);
    const response = await binaryRequest("GET", fileUrl);
    if (!response.ok) {
      throw await contentsError(response);
    }

    const details = detailsFromHeaders(url, response.headers);
    assertWithinSizeLimit(details.contentLength, maxBytes);

    const target = chooseTarget(details);
    const partial = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });

    const hash = createHash("sha256");
    const out = createWriteStream(partial);
    let size = 0;
    try {
      for await (const chunk of responseChunks(response)) {
        size += chunk.length;
        assertWithinSizeLimit(size, maxBytes);
        hash.update(chunk);
        if (!out.write(chunk)) {
          await once(out, "drain");
        }
      }
      out.end();
      await finished(out);
      await rename(partial, target);
    } catch (err) {
      out.destroy();
      await finished(out).catch(() => undefined);
      await rm(partial, { force: true });
      throw err;
    }

    return { ...details, path: target, size, sha256: hash.digest("hex") };
  }

  return {
    getSpaceMeetingInfo,
    listDirectMessages,
    deleteTeam,
    headContents,
    getContents,
    saveContents,
  };
}

export type SavedFile = FileDetails & {
  path: string;
  size: number;
  sha256: string;
};

const LOCKED_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 10_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function retryAfterMs(header: string | null): number {
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 2_000;
  }
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

async function* responseChunks(response: Response): AsyncGenerator<Uint8Array> {
  if (response.body) {
    yield* response.body as unknown as AsyncIterable<Uint8Array>;
    return;
  }
  yield new Uint8Array(await response.arrayBuffer());
}

export type RestClient = ReturnType<typeof createRestClient>;
