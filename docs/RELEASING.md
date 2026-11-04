# Publishing a release

Use **Actions → Release → Run workflow** to prepare a version PR. After a
maintainer merges it, the workflow creates a stable GitHub Release and explicitly
dispatches **Publish to npm**. The package is published with the npm `latest` tag.
Publishing a stable GitHub Release manually is also supported. Pushing a commit
or tag alone, draft releases and prereleases do not publish a package.

## One-time GitHub setup

In **Settings → Actions → General → Workflow permissions**, enable **Allow
GitHub Actions to create and approve pull requests**. Repository or organization
policy must also allow the job-scoped `contents: write`, `pull-requests: write`
and `actions: write` permissions declared in the Release workflow. The workflow
uses the built-in `GITHUB_TOKEN`; no PAT or new secret is needed. The workflow
does not approve or merge its own PRs.

GitHub may require a maintainer to select **Approve workflows to run** on a
bot-created PR before CI starts. Approve that run and wait for its `test` check
before merging, including when branch protection requires the check.

## One-time npm setup

After merging the workflows into `main`, open the settings for
[`@yuryev89/webex-mcp`](https://www.npmjs.com/package/@yuryev89/webex-mcp).
In **Trusted publishing**, add **GitHub Actions** with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `yuryev89` |
| Repository | `webexmcp` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty |
| Allowed actions | Enable direct publishing with `npm publish` |

No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. The job uses a GitHub-hosted
runner, Node 24, npm 11.12.1, and `id-token: write` for OIDC authentication.
For this public repository and package, npm generates provenance automatically.

A new trusted publisher must complete its first successful publication within
two days; otherwise delete the expired configuration and add it again.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Release a new version

1. Merge the changes to ship into `main`.
2. Open [Actions → Release](https://github.com/yuryev89/webexmcp/actions/workflows/release.yml)
   and select **Run workflow**, using branch **main**.
3. Choose `patch`, `minor` or `major`. For example, from `0.2.7` these produce
   `0.2.8`, `0.3.0` and `1.0.0`, respectively.
4. Open the PR linked in the workflow summary. It changes only `package.json`
   and `package-lock.json`, on branch `release/v<version>`. Only one open release
   PR is allowed at a time; merge or close it before requesting another bump.
5. Review the version, approve CI if prompted, wait for the checks, then merge
   the PR. Merge commits, squash and rebase merges are supported.
6. The **Release** workflow verifies that the merged PR is an ordinary bot-created
   release PR from this repository and only changes synchronized version values.
   It creates the stable tag and Release at the exact merged commit, generates
   release notes and dispatches **Publish to npm** at that tag.
7. Wait for **Publish to npm** to finish, then verify:
   `npm view @yuryev89/webex-mcp version`.

Do not rename the generated branch, add other changes to its PR, or merge a
stale version bump. If another version has already landed in `main`, close the
stale PR and prepare a fresh release. Unrelated code changes can land in main
while the version PR is open; the release includes main as of the merge.

The explicit dispatch is intentional: a Release created with `GITHUB_TOKEN`
does not trigger a separate `release: published` workflow. `workflow_dispatch`
does. See [GitHub's event rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
The npm publishing job remains in `publish.yml`, preserving the existing npm
Trusted Publisher configuration.

## Manual fallback

If a version was bumped manually, publish a stable GitHub Release with tag
`v<package.json version>` at the matching main commit. Both package files must
agree. This runs the same publishing checks. To retry an existing stable release,
use **Actions → Publish to npm → Run workflow**, choose the **release tag** as
the workflow ref and supply that same tag in the `tag` input. Do not run an old
release through a newer workflow ref.
Tags from before this automation was introduced do not have its manual-dispatch
entry point; retry their original publishing run instead.

## Failures and retries

- **Invalid release:** fix the package/lockfile version or release tag. Tags must
  have the `v` prefix and a stable version such as `v0.2.7`.
- **Authentication error:** check the exact trusted publisher fields, its expiry,
  and permission to use `npm publish`. The workflow does not use a GitHub environment.
- **Tests, build, or packaging failed:** fix the issue before publishing. If a
  corrected commit is needed, create a new release/tag for that commit.
- **PR creation forbidden:** enable the GitHub setting above; organization
  restrictions may need an administrator. No branch is force-pushed or deleted.
- **Preparation stopped after branch creation:** rerun the original preparation
  job. It reuses the branch only when its tree and parent match the expected
  version-only commit. If main moved, inspect and remove the orphan branch
  manually before starting a new preparation run.
- **Release creation succeeded but dispatch failed:** rerun the failed Release
  job. It verifies the existing tag still points to the same merged commit,
  reuses the stable Release and dispatches publication again.
  Automatically generated tags are lightweight; a manually created annotated tag
  is deliberately rejected by this recovery path and requires maintainer review.
- **Transient failure before publication:** use **Re-run failed jobs** in Actions.
- **Version already exists:** check `npm view @yuryev89/webex-mcp@<version> version`.
  The workflow skips publication if that exact version already exists in the
  registry. Registry errors fail the check; they do not count as a missing
  version. npm may take a few minutes to expose a newly published version.
  Never overwrite or delete a published version; release a new one for corrections.

Publishing is serialized, and in-progress publication jobs are not cancelled by
a newer release. A successful npm publication is public; editing or deleting
the GitHub Release does not undo it.
