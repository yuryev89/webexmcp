# Release workflow implementation plan

**Goal:** Select a version bump in Actions, review its PR, then publish automatically.
**Architecture:** Release workflow calls tested CommonJS helpers through github-script.
The existing publish workflow gains a validated manual-dispatch entry point.
**Tech stack:** GitHub Actions, Node 24, npm, node:test, GitHub REST API.
**Spec:** ../specs/2026-11-04-release-workflow-design.md

## Review focus

GITHUB_TOKEN event suppression, bot PR CI approval, stale or tampered version PRs,
retries after tag/release creation, and simultaneous bump requests must be covered.

## Tasks

- [x] Write failing tests for patch/minor/major preparation, invalid bump,
  duplicate PR, synchronized lockfile and exact version-only commit.
- [x] Write failing tests for merge origin/file/version guards, merged SHA targeting,
  existing tag/release validation and explicit publish dispatch.
- [x] Implement scripts/release-automation.cjs and workflow wiring.
- [x] Extend publish.yml for workflow_dispatch; preserve stable Release triggers,
  tag validation, OIDC, serialization, tests and packaging checks.
- [x] Update maintainer documentation, run tests/build and workflow linting.
- [x] Obtain independent review and fix substantive findings.
- [ ] Commit, push and open PR.

## Verification and review

26 new helper tests passed after observing their failures before implementation.
Full suite: 136/136 passed; TypeScript build, actionlint 1.7.7 and diff whitespace
checks passed. GitHub API writes and registry responses are stubbed in tests;
no real release or npm publication was requested while developing this feature.

Independent review found shared workflow concurrency could cancel pending release
finalization when unrelated PRs close. Finalization now groups by PR number;
preparation remains globally serialized. Documented recovery limits: generated
lightweight tags only, and historical tags must retry their original workflow.
