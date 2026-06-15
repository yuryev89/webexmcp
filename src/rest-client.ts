import { getApiBaseUrl } from "./auth/config.js";

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

  return {
    getSpaceMeetingInfo,
    listDirectMessages,
    deleteTeam,
  };
}

export type RestClient = ReturnType<typeof createRestClient>;
