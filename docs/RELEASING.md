# Publishing a release

Stable releases are published to npm by `.github/workflows/publish.yml` when a
GitHub Release is published. Pushing a commit or tag alone does not publish a
package. Draft releases and releases marked as prereleases do not publish.

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

## First release: 0.2.6

The package and synchronized lockfile contain version `0.2.6`, while npm has
`0.2.5`. Do not increment the version again for this first release.

1. Merge the publishing changes into `main` and wait for CI to pass.
2. Configure the npm trusted publisher as described above.
3. Open [New release](https://github.com/yuryev89/webexmcp/releases/new).
4. Create tag `v0.2.6` targeting the latest `main` commit that includes the workflows.
5. Add release notes; leave **Set as a pre-release** unchecked; publish the release.
6. Wait for **Publish to npm** in GitHub Actions to complete successfully.
7. Verify `npm view @yuryev89/webex-mcp version` returns `0.2.6` and check the CLI:
   `npx --yes @yuryev89/webex-mcp@0.2.6 --help`.

## Subsequent releases

Start from an up-to-date `main` on a clean working tree. For a patch release:

```sh
npm ci
npm test
npm run build
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Bump package version for release"
git push origin main
```

Use `minor` or `major` when appropriate. If changes must go through a pull
request, merge the version bump there instead of pushing directly to `main`.
Wait for CI, then publish a GitHub Release with tag `v<package.json version>`
targeting that commit. The publishing job repeats tests and build, checks the
release tag and both lockfile versions, verifies the tarball contents, and
publishes that exact tarball with npm dist-tag `latest`.

## Failures and retries

- **Invalid release:** fix the package/lockfile version or release tag. Tags must
  have the `v` prefix and a stable version such as `v0.2.7`.
- **Authentication error:** check the exact trusted publisher fields, its expiry,
  and permission to use `npm publish`. The workflow does not use a GitHub environment.
- **Tests, build, or packaging failed:** fix the issue before publishing. If a
  corrected commit is needed, create a new release/tag for that commit.
- **Transient failure before publication:** use **Re-run failed jobs** in Actions.
- **Version already exists:** check `npm view @yuryev89/webex-mcp@<version> version`.
  npm versions cannot be overwritten. If it exists, do not delete or republish it;
  release a new version for any corrections.

Publishing is serialized, and in-progress publication jobs are not cancelled by
a newer release. A successful npm publication is public; editing or deleting
the GitHub Release does not undo it.
