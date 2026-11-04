# Release workflow

The user selected manual patch/minor/major selection, a version PR, and automatic
publication after its merge. Add `Release` using workflow_dispatch on main and
pull_request closed on main. Preparation snapshots main, changes only package
and lockfile versions, and opens one bot-authored release/vVERSION PR. An open
release PR blocks another request. No version is bumped in this implementation PR.

After a maintainer merges the version PR, validate its origin, its two-file diff,
its stable version increment and its merged package/lock consistency before
creating a stable GitHub Release at that exact merge SHA. Explicitly dispatch
publish.yml at the tag: GITHUB_TOKEN release events do not trigger other workflows.
Keep npm Trusted Publishing configured for publish.yml and retain manual Releases.

Use GitHub-hosted Node 24, existing npm dependencies, built-in GITHUB_TOKEN and
job-scoped permissions. Only an ordinary same-repository bot release PR qualifies.
No automatic merge. Document repository permission to create PRs, possible CI
approval for bot PRs, failure recovery and supported merge methods. Block stale
version increments and mismatched existing tags. Tests mock GitHub API boundaries;
no real release or publication while developing this change.

Alternative: Conventional Commits was declined. Using a PAT solely to trigger
release publication adds credentials; explicit dispatch avoids it.
