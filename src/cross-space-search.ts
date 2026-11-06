import type { WebexClient } from "./webex.js";

type SearchClient = Pick<WebexClient, "listSpaces" | "searchMessages">;

export type CrossSpaceSearchParams = {
  query: string;
  roomIds?: string[];
  maxSpaces?: number;
  maxResults?: number;
  scanLimitPerSpace?: number;
  concurrency?: number;
  before?: string;
  maxSnippetChars?: number;
};

function snippetFor(text: string, query: string, maxChars: number) {
  const match = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = match < 0 ? 0 : Math.max(0, match - Math.floor(maxChars / 3));
  const end = Math.min(text.length, start + maxChars);
  const snippet = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  return { snippet, snippetTruncated: start > 0 || end < text.length };
}

/**
 * Bounded, live cross-space lookup. This is not a server-side global search:
 * it searches explicitly named spaces or the first N recently active spaces.
 * Each room's server-side Webex history scan is bounded independently.
 */
export async function searchAcrossSpaces(
  client: SearchClient,
  params: CrossSpaceSearchParams
) {
  const query = params.query.trim();
  if (!query) throw new Error("query must not be empty");
  const maxSpaces = Math.max(1, Math.min(params.maxSpaces ?? 10, 100));
  const maxResults = Math.max(1, Math.min(params.maxResults ?? 20, 100));
  const scanLimitPerSpace = Math.max(1, Math.min(params.scanLimitPerSpace ?? 200, 2000));
  const concurrency = Math.max(1, Math.min(params.concurrency ?? 3, 4));
  const maxSnippetChars = Math.max(80, Math.min(params.maxSnippetChars ?? 320, 2000));

  const explicit = params.roomIds !== undefined;
  if (explicit && (!params.roomIds?.length || params.roomIds.length > 100)) {
    throw new Error("roomIds must contain 1–100 space IDs");
  }

  let roomIds: string[];
  if (explicit) {
    roomIds = [...new Set(params.roomIds!.map((id) => id.trim()))];
  } else {
    const spaces = await client.listSpaces({ max: maxSpaces, sortBy: "lastactivity" });
    roomIds = [...new Set(spaces.spaces.map((space) => space.id).filter(
      (id): id is string => Boolean(id)
    ))].slice(0, maxSpaces);
  }
  if (roomIds.some((id) => !id)) throw new Error("Space IDs must be nonempty");

  type PerSpaceResult = Awaited<ReturnType<SearchClient["searchMessages"]>>;
  const responses: Array<PerSpaceResult | undefined> = new Array(roomIds.length);
  const failures: Array<{ roomId: string; error: string }> = [];
  let cursor = 0;

  async function worker() {
    while (cursor < roomIds.length) {
      const position = cursor++;
      const roomId = roomIds[position]!;
      try {
        responses[position] = await client.searchMessages({
          roomId,
          query,
          maxResults,
          scanLimit: scanLimitPerSpace,
          ...(params.before ? { before: params.before } : {}),
        });
      } catch (error) {
        failures.push({
          roomId,
          error: error instanceof Error ? error.message.slice(0, 200) : "Webex search failed",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, roomIds.length) }, () => worker())
  );

  const seen = new Set<string>();
  const found: Array<{
    id: string;
    roomId: string;
    personEmail?: string;
    created?: string;
    parentId?: string;
    snippet: string;
    snippetTruncated: boolean;
    fileCount?: number;
  }> = [];
  let scannedMessages = 0;
  let truncatedHistory = false;
  for (let i = 0; i < responses.length; i++) {
    const result = responses[i];
    if (!result) continue;
    scannedMessages += result.scanned;
    truncatedHistory ||= result.hasMore;
    for (const message of result.messages) {
      if (!message.id) continue;
      const roomId = message.roomId ?? roomIds[i]!;
      const key = `${roomId}:${message.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const text = [message.text, message.markdown].find(
        (value) => value?.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      ) ?? message.text ?? message.markdown ?? "";
      const { snippet, snippetTruncated } = snippetFor(text, query, maxSnippetChars);
      found.push({
        id: message.id,
        roomId,
        ...(message.personEmail ? { personEmail: message.personEmail } : {}),
        ...(message.created ? { created: message.created } : {}),
        ...(message.parentId ? { parentId: message.parentId } : {}),
        snippet,
        snippetTruncated,
        ...(message.files?.length ? { fileCount: message.files.length } : {}),
      });
    }
  }

  found.sort((a, b) => {
    const byDate = (Date.parse(b.created ?? "") || 0) - (Date.parse(a.created ?? "") || 0);
    return byDate || a.roomId.localeCompare(b.roomId) || a.id.localeCompare(b.id);
  });

  // Discovery scans only the most recently active spaces, not an exhaustive
  // account-wide set. Never describe it as complete global search.
  const scopeLimited = !explicit;
  return {
    query,
    scope: explicit ? "specified-spaces" as const : "recent-spaces" as const,
    requestedSpaces: roomIds.length,
    searchedSpaces: responses.filter(Boolean).length,
    failedSpaces: failures.length,
    scannedMessages,
    matchesFound: found.length,
    returned: Math.min(maxResults, found.length),
    partial: scopeLimited || truncatedHistory || found.length > maxResults || failures.length > 0,
    ...(failures.length ? { errors: failures } : {}),
    messages: found.slice(0, maxResults),
  };
}
