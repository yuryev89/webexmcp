import { getApiBaseUrl } from "./auth/config.js";
import {
  MAX_FILE_BYTES,
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

    return response;
  }

  async function headContents(fileUrl: string): Promise<FileDetails> {
    const url = resolveContentsUrl(fileUrl, opts.fedramp ?? false);
    let response = await binaryRequest("HEAD", fileUrl);
    if (response.status === 405) {
      response = await binaryRequest("GET", fileUrl);
    }
    if (!response.ok) {
      throw new Error(await parseErrorBody(response));
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
      throw new Error(await parseErrorBody(response));
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

  return {
    getSpaceMeetingInfo,
    listDirectMessages,
    deleteTeam,
    headContents,
    getContents,
  };
}

export type RestClient = ReturnType<typeof createRestClient>;
