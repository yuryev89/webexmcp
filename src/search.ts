export type SearchableSpace = {
  title?: string;
};

export type SearchableMessage = {
  text?: string;
  markdown?: string;
};

export type PagedResult<T> = {
  items: T[];
  next?: () => Promise<PagedResult<T>>;
};

export function matchesSpaceTitle(space: SearchableSpace, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  return (space.title ?? "").toLowerCase().includes(q);
}

export function matchesMessageText(message: SearchableMessage, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return false;
  const text = (message.text ?? "").toLowerCase();
  const markdown = (message.markdown ?? "").toLowerCase();
  return text.includes(q) || markdown.includes(q);
}

export async function scanPagedMatches<T>(params: {
  fetchFirstPage: () => Promise<PagedResult<T>>;
  matches: (item: T) => boolean;
  maxResults: number;
  scanLimit: number;
}): Promise<{ matched: T[]; scanned: number; hasMore: boolean }> {
  const matched: T[] = [];
  let scanned = 0;
  let hasMore = false;
  let page = await params.fetchFirstPage();

  while (true) {
    for (const item of page.items) {
      scanned++;
      if (params.matches(item)) {
        matched.push(item);
        if (matched.length >= params.maxResults) {
          hasMore = scanned < params.scanLimit && Boolean(page.next);
          return { matched, scanned, hasMore };
        }
      }
      if (scanned >= params.scanLimit) {
        hasMore = Boolean(page.next);
        return { matched, scanned, hasMore };
      }
    }

    if (!page.next) {
      return { matched, scanned, hasMore: false };
    }

    page = await page.next();
  }
}
