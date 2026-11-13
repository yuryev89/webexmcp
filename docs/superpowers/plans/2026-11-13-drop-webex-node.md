# webex-mcp: replace webex-node with the existing REST client — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@yuryev89/webex-mcp` stops depending on `webex-node`; every Webex call goes through `src/rest-client.ts` over plain `fetch`, with tool behaviour unchanged.

**Architecture:** `src/webex.ts` is the only file that loads the SDK (`require("webex-node")`, ~30 calls such as `webex.rooms.list`, `webex.messages.create`). All of them are thin wrappers over the public REST API `https://webexapis.com/v1`. The package already has `src/rest-client.ts` (fetch, token refresh on 401, `Retry-After` for binary requests, FedRAMP base URL). We extend it with typed errors, 429 retry and Link-header pagination, then put an object with the same shape as the SDK (`api.rooms.list(...)` returning `{ items, next? }`) in front of it, so `search.ts`, `fetchAllSpacesForCache` and the normalizers stay as they are.

**Tech Stack:** TypeScript, Node.js 22 (global `fetch`, `FormData`, `fs.openAsBlob`), tests: `node --import tsx --test test/*.test.ts` (`npm test`), build: `tsc`.

**Spec:** this document (the problem was found in `openchamber-wp`, see "Why" below).

## Why

`npm install @yuryev89/webex-mcp@0.3.0` on a clean cache: **862 packages, 508 MB, 146 s**. The chain is
`webex-node → @webex/internal-plugin-calendar → @webex/internal-plugin-encryption → isomorphic-webcrypto → expo-random → expo, react-native, hermes-compiler…`
(`isomorphic-webcrypto` declares expo/react-native as peer dependencies, which npm 7+ installs). `openchamber-wp` now passes `--legacy-peer-deps` as a stopgap: 61 s / 176 MB. Without `webex-node` the remaining dependencies (`@modelcontextprotocol/sdk`, `dotenv`, `yargs`, `zod`) install in **7 s / 27 MB**. Meetings, calling, calendar and encryption plugins are not used by any tool.

## Global Constraints

- Tool names, input schemas and output shapes stay exactly the same (consumers allowlist tools by name: `webex_get_person`, `webex_get_people`, `webex_list_spaces`, `webex_search_spaces`, `webex_get_space`, `webex_get_messages`, `webex_search_messages`, `webex_list_direct_messages`, `webex_create_message`, …).
- No new runtime dependencies. `dependencies` after the change: `@modelcontextprotocol/sdk`, `dotenv`, `yargs`, `zod` only.
- Node.js ≥ 22 stays the floor (`engines`), no polyfills.
- FedRAMP keeps working: every URL is built from `getApiBaseUrl(fedramp)`; `next` links are followed verbatim.
- OAuth flow (`src/auth/*`) and the saved token storage are not touched.
- Errors shown to the user keep the current text: the Webex `message` field of the error body (what `parseErrorBody` returns today).

## Review Focus

1. **Pagination cursor:** the `next` URL from the `Link` header already carries all query parameters (including the cursor); the client must request it as-is and not re-append `max`/`roomId`. Otherwise page 2 repeats page 1 and `webex_search_messages` loops until `scanLimit`.
2. **401 in the middle of pagination:** the token expires between page 1 and page 2; `page.next()` must refresh and retry like any other request, not fail the whole search.
3. **429 on list/search calls:** a busy org gets `429 Retry-After: N` on `/messages`; today the SDK retries silently. Without a retry in `request()` the search tools would start failing.
4. **Auth detection by status:** `isAuthError` in `webex.ts` reads `err.statusCode`; a plain `Error(message)` from `rest-client` loses it, and `withAuthRetry` would stop refreshing tokens.
5. **File upload:** `webex_create_message` with `filePath` must still send multipart (`files` part) with the original file name, and keep the existing checks (regular file, ≤ 100 MB) and their messages.

Each line has a test in the task that owns the code (marked "Review Focus N").

---

### Task 1: rest-client — typed errors, 429 retry, paged lists

**Files:**
- Modify: `src/rest-client.ts` (`request`, `parseErrorBody`, export list)
- Test: `test/rest-client.test.ts` (create it, or extend the existing one; stub `globalThis.fetch` the way the existing tests do)

**Interfaces:**
- Produces:
  - `export class WebexApiError extends Error { statusCode: number; trackingId?: string }`: thrown by `request()` for every non-2xx response; `message` = what `parseErrorBody` returns today; `trackingId` from the `trackingid` response header.
  - `export interface Page<T> { items: T[]; next?: () => Promise<Page<T>> }`
  - `rest.list<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<Page<T>>`
  - `rest.request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, options?: { query?; body?; form?: FormData }): Promise<T>`, exposed on the returned client (it is internal today). `form` is sent as the body without a `Content-Type` header (fetch sets the boundary).

- [ ] **Step 1: Write the failing tests**
  - `request throws WebexApiError with statusCode`: fetch → `404 {"message":"Room not found"}`; expect `WebexApiError`, `statusCode === 404`, `message === "Room not found"`.
  - `request retries 429 using Retry-After` (Review Focus 3): fetch → `429 Retry-After: 1`, then `200 {"id":"r1"}`; inject `sleep` through `opts.sleep`; expect result `{id:"r1"}`, `sleep` called with `1000`, 2 fetch calls. After 3 consecutive 429s it throws `WebexApiError` with `statusCode === 429`.
  - `list follows Link next verbatim` (Review Focus 1): page 1 → `{items:[a]}` + header `Link: <https://webexapis.com/v1/messages?roomId=R&max=1&beforeMessage=X>; rel="next"`; page 2 → `{items:[b]}` without `Link`. Expect the second fetch URL to equal the Link URL exactly; `page2.next === undefined`; items `[a]`, `[b]`.
  - `list next refreshes token on 401` (Review Focus 2): page 2 answers 401 once, then 200; expect `refreshToken` called once and page 2 items returned.

- [ ] **Step 2: Run, expect failure:** `npm test` → the new tests fail (`WebexApiError` not exported / `list` is not a function).

- [ ] **Step 3: Implement** in `src/rest-client.ts`. `request()` gets the 429 loop that `binaryRequest` already has (`retryAfterMs`, at most 3 attempts) and throws `WebexApiError`. `list()` accepts either a path or an absolute URL (for `next`), parses `Link` with a `rel="next"` regex, and builds `next` only when the header is present. 401 refresh stays in one place (`request`), so `next()` inherits it.

- [ ] **Step 4: Run:** `npm test`: all pass, including the old rest-client tests.

- [ ] **Step 5: Commit:** `git commit -m "feat(rest-client): typed errors, 429 retry and Link pagination"`

### Task 2: SDK-shaped resource layer; webex.ts off webex-node

**Files:**
- Create: `src/resources.ts`
- Modify: `src/webex.ts` (remove `createRequire`/`require("webex-node")`, `initWebex`, the `webex` variable and its re-init in `withAuthRetry`)
- Test: `test/resources.test.ts`

**Interfaces:**
- Consumes: `rest.list`, `rest.request`, `WebexApiError`, `Page<T>` from Task 1.
- Produces: `createWebexApi(rest): WebexApi`, where `WebexApi` has the same members `webex.ts` uses now:

| member | path | methods |
|---|---|---|
| `rooms` | `/rooms` | list, get, create, update, remove |
| `memberships` | `/memberships` | list, get, create, update, remove |
| `messages` | `/messages` | list, get, create, update, remove |
| `people` | `/people` | list, get |
| `teams` | `/teams` | list, get, create, update |
| `teamMemberships` | `/team/memberships` | list, get, create, update, remove |
| `webhooks` | `/webhooks` | list, get, create, update, remove |
| `attachmentActions` | `/attachment/actions` | get, create |

  Semantics: `list(q)` → `GET path?q` → `Page`; `get(id)` → `GET path/{id}`; `create(body)` → `POST path`; `update(body)` → `PUT path/{body.id}` with the body without `id`; `remove(id)` → `DELETE path/{id}` (204 → `{deleted:true}`, as `request` returns now). Ids go through `encodeURIComponent`.

- [ ] **Step 1: Write the failing tests:** one table-driven test over the table above. For each member and method, a stub fetch records `method` and `url`, and the test asserts the path. Plus:
  - `update sends PUT to /rooms/{id} without id in body`: body `{id:"r 1", title:"T"}` → URL ends with `/rooms/r%201`, JSON body `{"title":"T"}`.
  - `withAuthRetry still refreshes on WebexApiError 401` (Review Focus 4): `createWebexClient` with `getToken` stub; first call 401, then 200; `getSpace` resolves and `getToken` was called once.

- [ ] **Step 2: Run, expect failure:** `npm test` → `createWebexApi` not found.

- [ ] **Step 3: Implement** `src/resources.ts` with one generic `resource(rest, path)` factory, and in `src/webex.ts` replace `webex.` with `api.` (`const api = createWebexApi(rest)`). `withAuthRetry` keeps its shape but only updates `currentToken`; nothing is re-initialized. `isAuthError` stays and now sees `statusCode` on `WebexApiError`. `search.ts` and `fetchAllSpacesForCache` are not changed: they already use `page.items` / `page.next`.

- [ ] **Step 4: Run:** `npm test` (all pass) and `npm run build` (no `tsc` errors); `grep -rn "webex-node" src` finds nothing.

- [ ] **Step 5: Commit:** `git commit -m "refactor: call Webex REST API directly instead of webex-node"`

### Task 3: message with a local file as multipart

**Files:**
- Modify: `src/webex.ts` (`createMessage`, the `filePath` branch; drop `createReadStream`/`once`/`finished` if unused)
- Test: `test/resources.test.ts` (or the existing messages test)

**Interfaces:**
- Consumes: `rest.request("POST", "/messages", { form })` from Task 1.
- Produces: none (internal to `createMessage`).

- [ ] **Step 1: Write the failing tests** (Review Focus 5):
  - `createMessage with filePath posts multipart`: temp file `report.txt` with `hello`; stub fetch captures `init.body`; expect `instanceof FormData`, `roomId` and `text` fields, `files` entry is a `File`/`Blob` named `report.txt` with content `hello`, and no explicit `Content-Type` header.
  - The existing checks keep their messages: a directory → `"filePath must point to a regular file"`; size > 100 MB (stub `stat`) → `"File exceeds the Webex 100 MB attachment limit"`.
  - `createMessage without filePath posts JSON`: body `{roomId, markdown, parentId}` as JSON.

- [ ] **Step 2: Run, expect failure:** `npm test`, the multipart test fails.

- [ ] **Step 3: Implement:** after the existing `stat` checks, build `FormData` from the text fields and `form.append("files", await openAsBlob(filePath), basename(filePath))` (`node:fs`).

- [ ] **Step 4: Run:** `npm test`, all pass.

- [ ] **Step 5: Commit:** `git commit -m "feat(messages): upload local files via multipart without the SDK"`

### Task 4: drop the dependency, verify, release

**Files:**
- Modify: `package.json` (remove `webex-node`; `version` → `0.4.0`), `package-lock.json`, `README.md` (if it mentions the SDK)

- [ ] **Step 1:** `npm uninstall webex-node && npm test && npm run build`: all pass.
- [ ] **Step 2: Clean install size and time.** Run `npm pack`, then install the tarball into an empty directory with an empty cache:
  `D=$(mktemp -d); C=$(mktemp -d); time npm install --cache "$C" --prefix "$D" --ignore-scripts --no-audit --no-fund ./yuryev89-webex-mcp-0.4.0.tgz; du -sh "$D/node_modules"`
  Expected: well under 15 s and under 40 MB, with no `expo`/`react-native` in `npm ls --prefix "$D" --all`.
- [ ] **Step 3: MCP smoke test** without credentials: send `initialize` + `notifications/initialized` + `tools/list` on stdin to `node dist/cli.js` with `WEBEX_CLIENT_ID=x WEBEX_CLIENT_SECRET=y`. Expected: an `initialize` result and the same tool list as 0.3.0 (diff the names against `npx @yuryev89/webex-mcp@0.3.0`).
- [ ] **Step 4: Live check with a real account** (human): list spaces, search messages in a space with more than one page (shows pagination), read a direct message, send a message with a file to the test space. Behaviour is the same as 0.3.0.
- [ ] **Step 5:** Commit `chore: drop webex-node (862 → ~100 packages, 146 s → ~7 s install)`, tag `v0.4.0`, `npm publish`.

## After release (openchamber-wp, not part of this plan)

`install.py` installs the latest `@yuryev89/webex-mcp`, so 0.4.0 is picked up automatically. The `--legacy-peer-deps` flag can then stay (harmless) or be removed after one clean install shows no `expo` in `.workplace/deps/node/node_modules`.
