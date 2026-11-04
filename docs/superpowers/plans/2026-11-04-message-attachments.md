# Message Attachments Implementation Plan

**Goal:** Send URL and local file attachments through the existing MCP message tool.
**Architecture:** Extend the tool schema and client, using SDK JSON/multipart support.
**Tech Stack:** TypeScript, Zod, Node streams, node:test, webex-node.
**Spec:** ../specs/2026-11-04-message-attachments-design.md

## Constraints and review focus

Preserve text-only behavior and normalized file metadata. Validate empty and
invalid inputs; distinguish public URLs from server-local paths. Reopen local
streams on auth retry, close them on errors, and preserve recipients/thread IDs.
Tests must not send actual Webex messages. Keep unrelated checkout edits out of PR.

## Task 1: Message attachments

- [x] Add tests through an in-memory MCP client/server, with the SDK send boundary
  stubbed: URL-only, local-only, captions, DM/thread routing, invalid input,
  nonexistent/directory/oversized files, API errors and fresh streams on retry.
- [x] Run the new tests and confirm failures are missing attachment behavior.
- [x] Extend `src/tools/messages.ts` with `files` and `filePath` validation and forwarding.
- [x] Extend `src/webex.ts` with URL forwarding and local file stream lifecycle.
- [x] Run new tests, full `npm test`, `npm run build`, and `git diff --check`.
- [x] Document tool usage and local file semantics in README.
- [x] Review the diff independently; no significant findings.
- [ ] Commit, push and open PR.

## Validation record

New attachment tests: 13/13 passed after observing 11 expected failures before
implementation. Full suite after rebasing onto current main: 90/90 passed.
TypeScript build and whitespace checks
passed. Independent review verified the installed SDK's multipart ReadStream
support. No live Webex messages were sent; multipart encoding was checked in SDK
source, while automated tests stub the SDK send boundary.
