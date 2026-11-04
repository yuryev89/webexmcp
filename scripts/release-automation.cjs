const assert = require("node:assert/strict");

const paths = ["package.json", "package-lock.json"];
const bumps = ["patch", "minor", "major"];

function nextVersion(version, bump) {
  assert(bumps.includes(bump), "Choose patch, minor or major");
  assert(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), "Expected a stable version");
  const parts = version.split(".").map(Number);
  assert(parts.every(Number.isSafeInteger), "Version exceeds safe integer range");
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index]++;
  assert(Number.isSafeInteger(parts[index]), "Version exceeds safe integer range");
  parts.fill(0, index + 1);
  return parts.join(".");
}

async function readFiles(github, repo, ref) {
  const files = {};
  for (const path of paths) {
    const { data } = await github.rest.repos.getContent({ ...repo, path, ref });
    files[path] = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
  }
  const pkg = files["package.json"];
  const lock = files["package-lock.json"];
  assert.equal(pkg.name, "@yuryev89/webex-mcp", "Unexpected package");
  assert.equal(lock.name, pkg.name, "Lockfile package name mismatch");
  assert.equal(lock.packages?.[""]?.name, pkg.name, "Lockfile root name mismatch");
  assert.equal(lock.version, pkg.version, "Lockfile version mismatch");
  assert.equal(lock.packages[""].version, pkg.version, "Lockfile root version mismatch");
  nextVersion(pkg.version, "patch"); // Also validates stable semantic version syntax.
  return files;
}

function setVersion(files, version) {
  files["package.json"].version = version;
  files["package-lock.json"].version = version;
  files["package-lock.json"].packages[""].version = version;
}

async function optional(request) {
  try {
    return (await request()).data;
  } catch (error) {
    if (error.status !== 404) throw error;
    return null;
  }
}

async function prepareRelease({ github, context, core }) {
  assert.equal(context.ref, "refs/heads/main", "Run Release from main");
  const bump = context.payload.inputs.bump;
  assert(bumps.includes(bump), "Choose patch, minor or major");
  const repo = context.repo;
  const open = await github.paginate(github.rest.pulls.list, { ...repo, state: "open", base: "main", per_page: 100 });
  assert(!open.some(pr => pr.head.ref.startsWith("release/v")), "Merge or close the existing release PR first");
  const files = await readFiles(github, repo, context.sha);
  const version = nextVersion(files["package.json"].version, bump);
  const branch = `release/v${version}`;
  setVersion(files, version);
  const { data: base } = await github.rest.git.getCommit({ ...repo, commit_sha: context.sha });
  const { data: tree } = await github.rest.git.createTree({
    ...repo, base_tree: base.tree.sha,
    tree: paths.map(path => ({ path, mode: "100644", type: "blob", content: `${JSON.stringify(files[path], null, 2)}\n` })),
  });
  const existing = await optional(() => github.rest.git.getRef({ ...repo, ref: `heads/${branch}` }));
  if (existing) {
    const { data: previous } = await github.rest.git.getCommit({ ...repo, commit_sha: existing.object.sha });
    assert.equal(previous.tree.sha, tree.sha, "Existing release branch has different contents");
    assert.deepEqual(previous.parents.map(parent => parent.sha), [context.sha], "Existing release branch has a different base");
  } else {
    const { data: commit } = await github.rest.git.createCommit({
      ...repo, message: `chore: release ${version}`, tree: tree.sha, parents: [context.sha],
    });
    await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: commit.sha });
  }
  const { data: pr } = await github.rest.pulls.create({
    ...repo, base: "main", head: branch, title: `chore: release ${version}`,
    body: `Bump package and lockfile to **${version}** (${bump}).\n\n` +
      "Review the version-only diff, approve workflows to run if GitHub requests it, and wait for CI before merging. " +
      "Merging this PR creates the GitHub Release and dispatches Publish to npm automatically.\n\n" +
      "<!-- automated-release -->",
  });
  await core.summary.addRaw(`Release PR: ${pr.html_url}\n`).write();
}

async function finalizeRelease({ github, context, core }) {
  const repo = context.repo;
  const pr = context.payload.pull_request;
  assert(pr.merged, "Release PR must be merged");
  assert.equal(pr.base.ref, "main", "Release PR must target main");
  assert.equal(pr.user.login, "github-actions[bot]", "Expected an automated release PR");
  assert.equal(pr.head.repo?.full_name, `${repo.owner}/${repo.repo}`, "Release PR must originate in this repository");
  assert(/^release\/v\d+\.\d+\.\d+$/.test(pr.head.ref), "Expected release/vVERSION branch");
  const changed = await github.paginate(github.rest.pulls.listFiles, { ...repo, pull_number: pr.number, per_page: 100 });
  assert.deepEqual(changed.map(file => file.filename).sort(), [...paths].sort(), "Release PR may only change version files");
  const sha = pr.merge_commit_sha;
  assert(sha, "Missing merge commit");
  const { data: commit } = await github.rest.git.getCommit({ ...repo, commit_sha: sha });
  // First parent is main before the merge (also works for squash and rebase).
  const before = await readFiles(github, repo, commit.parents[0].sha);
  const after = await readFiles(github, repo, sha);
  const version = after["package.json"].version;
  assert(bumps.some(bump => nextVersion(before["package.json"].version, bump) === version), "Release version is stale or not a single patch/minor/major increment");
  assert.equal(pr.head.ref, `release/v${version}`, "Branch and package version mismatch");
  setVersion(before, version);
  assert.deepEqual(after, before, "Release PR must only change version values");

  const tag = `v${version}`;
  const existingTag = await optional(() => github.rest.git.getRef({ ...repo, ref: `tags/${tag}` }));
  if (existingTag) assert.equal(existingTag.object.sha, sha, "Existing tag points to a different commit");
  const release = await optional(() => github.rest.repos.getReleaseByTag({ ...repo, tag }));
  if (release) {
    assert(existingTag, "Existing release must have a matching tag");
    assert(!release.draft && !release.prerelease, "Existing release must be stable and published");
  } else {
    await github.rest.repos.createRelease({
      ...repo, tag_name: tag, target_commitish: sha, name: tag,
      draft: false, prerelease: false, generate_release_notes: true,
    });
  }
  // Releases created with GITHUB_TOKEN do not emit another workflow run.
  // workflow_dispatch is an explicit exception to that recursion protection.
  await github.rest.actions.createWorkflowDispatch({ ...repo, workflow_id: "publish.yml", ref: tag, inputs: { tag } });
  await core.summary.addRaw(`Created ${tag} at ${sha}; dispatched Publish to npm.\n`).write();
}

async function isPublished(name, version, request = fetch) {
  const response = await request(new URL(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`), {
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 404) return false;
  assert(response.ok, `npm registry returned HTTP ${response.status}`);
  const pkg = await response.json();
  assert.equal(pkg.name, name, "Registry package name mismatch");
  assert.equal(pkg.version, version, "Registry version mismatch");
  return true;
}

module.exports = { prepareRelease, finalizeRelease, isPublished };
