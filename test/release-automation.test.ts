import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const load = () => createRequire(import.meta.url)("../scripts/release-automation.cjs");
const before = {
  "package.json": { name: "@yuryev89/webex-mcp", version: "0.2.7", scripts: { test: "node --test" } },
  "package-lock.json": { name: "@yuryev89/webex-mcp", version: "0.2.7", packages: {
    "": { name: "@yuryev89/webex-mcp", version: "0.2.7" }, "node_modules/zod": { version: "3.25.76" },
  } },
};
function versioned(version: string) {
  const files = structuredClone(before);
  files["package.json"].version = version;
  files["package-lock.json"].version = version;
  files["package-lock.json"].packages[""].version = version;
  return files;
}

function fixture() {
  const context: any = {
    repo: { owner: "yuryev89", repo: "webexmcp" }, sha: "main-sha", ref: "refs/heads/main",
    payload: { inputs: { bump: "patch" }, pull_request: {
      number: 12, merged: true, merge_commit_sha: "merged-sha",
      user: { login: "github-actions[bot]" }, base: { ref: "main" },
      head: { ref: "release/v0.2.8", repo: { full_name: "yuryev89/webexmcp" } },
    } },
  };
  const state: any = { baseFiles: structuredClone(before), files: versioned("0.2.8"), open: [], release: null, tag: null, branch: null,
    changed: [{ filename: "package.json" }, { filename: "package-lock.json" }] };
  const calls: { method: string; args: any }[] = [];
  const missing = () => { throw Object.assign(new Error("Not Found"), { status: 404 }); };
  const handlers: Record<string, (args: any) => any> = {
    "repos.getContent": ({ path, ref }) => ({ content: Buffer.from(JSON.stringify(
      (ref === "merged-sha" ? state.files : state.baseFiles)[path]
    )).toString("base64"), encoding: "base64" }),
    "pulls.list": () => state.open,
    "pulls.listFiles": () => state.changed,
    "git.getCommit": ({ commit_sha }) => ({ sha: commit_sha, tree: { sha: commit_sha === "version-sha" ? "new-tree" : "base-tree" }, parents: [{ sha: commit_sha === "version-sha" ? "main-sha" : "parent-sha" }] }),
    "git.createTree": () => ({ sha: "new-tree" }),
    "git.createCommit": () => ({ sha: "version-sha" }),
    "git.createRef": ({ sha }) => { state.branch = sha; return { object: { sha } }; },
    "git.getRef": ({ ref }) => {
      const sha = ref.startsWith("heads/") ? state.branch : state.tag;
      return sha ? { object: { sha } } : missing();
    },
    "pulls.create": () => ({ number: 12, html_url: "https://github.com/yuryev89/webexmcp/pull/12" }),
    "repos.getReleaseByTag": () => state.release ?? missing(),
    "repos.createRelease": (args) => { state.tag = args.target_commitish; return state.release = { ...args, draft: false, prerelease: false }; },
    "actions.createWorkflowDispatch": () => ({}),
  };
  // Only GitHub HTTP boundaries are replaced; all version/diff/retry decisions
  // run in the production helper. Captured requests are the external contract.
  const rest = new Proxy({}, { get: (_, group: string) => new Proxy({}, {
    get: (_, name: string) => async (args: any) => {
      const method = `${group}.${name}`;
      calls.push({ method, args });
      assert.ok(handlers[method], `Unexpected API request: ${method}`);
      return { data: handlers[method]!(args) };
    },
  }) });
  const github: any = { rest, paginate: async (method: any, args: any) => (await method(args)).data };
  const core = { summary: { addRaw() { return this; }, async write() {} } };
  return { context, state, calls, github, core };
}

describe("release preparation", () => {
  it("reuses its version branch when a previous run failed before opening the PR", async () => {
    const f = fixture();
    f.state.branch = "version-sha";
    await load().prepareRelease(f);
    assert.equal(f.calls.some(c => c.method === "git.createRef" || c.method === "git.createCommit"), false);
    assert.equal(f.calls.at(-1)?.method, "pulls.create");
  });

  it("does not reuse an unrelated existing version branch", async () => {
    const f = fixture();
    f.state.branch = "unrelated-sha";
    await assert.rejects(() => load().prepareRelease(f));
    assert.equal(f.calls.some(c => c.method === "pulls.create" || c.method === "git.createRef"), false);
  });
  for (const [bump, version] of [["patch", "0.2.8"], ["minor", "0.3.0"], ["major", "1.0.0"]]) {
    it(`opens a ${bump} PR with only synchronized version changes`, async () => {
      const f = fixture();
      f.context.payload.inputs.bump = bump;
      await load().prepareRelease(f);
      const tree = f.calls.find(c => c.method === "git.createTree")!.args;
      assert.equal(tree.base_tree, "base-tree");
      assert.deepEqual(tree.tree.map((entry: any) => entry.path).sort(), ["package-lock.json", "package.json"]);
      const files = Object.fromEntries(tree.tree.map((e: any) => [e.path, JSON.parse(e.content)]));
      assert.deepEqual(files, versioned(version!));
      assert.deepEqual(f.calls.find(c => c.method === "git.createCommit")!.args.parents, ["main-sha"]);
      assert.equal(f.calls.find(c => c.method === "pulls.create")!.args.head, `release/v${version}`);
      assert.equal(f.calls.find(c => c.method === "pulls.create")!.args.base, "main");
    });
  }

  for (const condition of ["invalid bump", "wrong branch", "open release PR", "stale lockfile"] as const) {
    it(`rejects ${condition} before writing to GitHub`, async () => {
      const f = fixture();
      if (condition === "invalid bump") f.context.payload.inputs.bump = "premajor";
      if (condition === "wrong branch") f.context.ref = "refs/heads/feature";
      if (condition === "open release PR") f.state.open = [{ head: { ref: "release/v0.3.0" } }];
      if (condition === "stale lockfile") {
        f.state.baseFiles["package-lock.json"].version = "0.2.6";
      }
      await assert.rejects(() => load().prepareRelease(f));
      assert.equal(f.calls.some(c => /create/.test(c.method)), false);
    });
  }
});

describe("npm publication retry", () => {
  it("skips a package version already published", async () => {
    const published = await load().isPublished("@yuryev89/webex-mcp", "0.2.8", async (url: URL) => {
      assert.equal(String(url), "https://registry.npmjs.org/%40yuryev89%2Fwebex-mcp/0.2.8");
      return { status: 200, ok: true, json: async () => ({ name: "@yuryev89/webex-mcp", version: "0.2.8" }) };
    });
    assert.equal(published, true);
  });
  it("publishes a version absent from npm", async () => {
    assert.equal(await load().isPublished("@yuryev89/webex-mcp", "0.2.8", async () => ({ status: 404 })), false);
  });
  it("does not treat a registry outage as permission to publish", async () => {
    await assert.rejects(() => load().isPublished("@yuryev89/webex-mcp", "0.2.8", async () => ({ status: 503, ok: false })));
  });
});

describe("merged release PR", () => {
  it("creates a stable release at the merge SHA and explicitly dispatches publishing at the tag", async () => {
    const f = fixture();
    await load().finalizeRelease(f);
    const release = f.calls.find(c => c.method === "repos.createRelease")!.args;
    assert.equal(release.tag_name, "v0.2.8");
    assert.equal(release.target_commitish, "merged-sha");
    assert.equal(release.prerelease, false);
    assert.equal(release.generate_release_notes, true);
    assert.deepEqual(f.calls.at(-1), { method: "actions.createWorkflowDispatch", args: {
      owner: "yuryev89", repo: "webexmcp", workflow_id: "publish.yml", ref: "v0.2.8", inputs: { tag: "v0.2.8" },
    } });
  });

  it("resumes after a release was created but publish dispatch failed", async () => {
    const f = fixture();
    f.state.release = { tag_name: "v0.2.8", draft: false, prerelease: false };
    f.state.tag = "merged-sha";
    await load().finalizeRelease(f);
    assert.equal(f.calls.some(c => c.method === "repos.createRelease"), false);
    assert.equal(f.calls.at(-1)?.method, "actions.createWorkflowDispatch");
  });

  for (const condition of ["unmerged", "wrong author", "fork", "wrong base", "wrong branch", "extra files", "package changes", "dependency changes", "stale version", "lock mismatch", "tag points elsewhere", "prerelease"] as const) {
    it(`does not publish when ${condition}`, async () => {
      const f = fixture();
      const pr = f.context.payload.pull_request;
      if (condition === "unmerged") pr.merged = false;
      if (condition === "wrong author") pr.user.login = "someone-else";
      if (condition === "fork") pr.head.repo.full_name = "other/webexmcp";
      if (condition === "wrong base") pr.base.ref = "feature";
      if (condition === "wrong branch") pr.head.ref = "feature";
      if (condition === "extra files") f.state.changed.push({ filename: "src/cli.ts" });
      if (condition === "package changes") f.state.files["package.json"].scripts.test = "echo fake";
      if (condition === "dependency changes") f.state.files["package-lock.json"].packages["node_modules/zod"].version = "4.0.0";
      if (condition === "stale version") f.state.files = versioned("0.2.7");
      if (condition === "lock mismatch") f.state.files["package-lock.json"].packages[""].version = "0.2.6";
      if (condition === "tag points elsewhere") f.state.tag = "another-sha";
      if (condition === "prerelease") {
        f.state.tag = "merged-sha";
        f.state.release = { tag_name: "v0.2.8", draft: false, prerelease: true };
      }
      await assert.rejects(() => load().finalizeRelease(f));
      assert.equal(f.calls.some(c => c.method === "repos.createRelease" || c.method === "actions.createWorkflowDispatch"), false);
    });
  }
});
