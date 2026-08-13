import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PortalConfig } from "../shared/contracts.js";
import { listBranchTree, readBranchDocument, readBranchImage, remoteToWebUrl, repositoryInfo } from "./git.js";
import { PathPolicy } from "./policy.js";

test("normalizes common GitHub remote formats", () => {
  assert.equal(remoteToWebUrl("git@github.com:owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(remoteToWebUrl("https://github.com/owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(remoteToWebUrl("ssh://git@github.com/owner/repo.git"), "https://github.com/owner/repo");
});

test("does not invent links for local remotes", () => {
  assert.equal(remoteToWebUrl("/srv/git/repo.git"), null);
});

test("unreadable Git metadata does not block file browsing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-portal-git-"));
  const gitDir = path.join(root, ".git");
  await mkdir(gitDir);
  await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(path.join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");
  await chmod(path.join(gitDir, "config"), 0o000);
  try {
    assert.equal(await repositoryInfo(root, root), null);
  } finally {
    await chmod(path.join(gitDir, "config"), 0o600);
  }
});

test("lists loose and packed local branches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-portal-branches-"));
  const gitDir = path.join(root, ".git");
  await mkdir(path.join(gitDir, "refs", "heads", "feature"), { recursive: true });
  await writeFile(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  await writeFile(path.join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n");
  await writeFile(path.join(gitDir, "refs", "heads", "main"), "0123456789abcdef\n");
  await writeFile(path.join(gitDir, "refs", "heads", "feature", "portal"), "0123456789abcdef\n");
  await writeFile(path.join(gitDir, "packed-refs"), "# pack-refs\n0123456789abcdef refs/heads/release/v1\n");
  const info = await repositoryInfo(root, root);
  assert.deepEqual(info?.localBranches, ["feature/portal", "main", "release/v1"]);
});

test("browses files from another branch without changing the working tree", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-portal-branch-tree-"));
  const git = (...args: string[]) => execFileSync("git", args, {
    cwd: root,
    env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" },
  });
  git("init", "-b", "main");
  await writeFile(path.join(root, "README.md"), "# Main\n");
  git("add", "README.md"); git("commit", "-m", "main");
  git("checkout", "-b", "feature/docs");
  await mkdir(path.join(root, "notes"));
  await writeFile(path.join(root, "notes", "feature.md"), "# Feature branch\n");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==", "base64");
  await writeFile(path.join(root, "notes", "preview.png"), png);
  git("add", "notes/feature.md", "notes/preview.png"); git("commit", "-m", "feature");
  git("checkout", "main");

  const config: PortalConfig = {
    title: "Test", roots: [{ path: ".", label: "Root", kind: "projects" }],
    excludeSegments: ["node_modules"], allowedExtensions: [".md", ".png"], allowedNames: [],
    maxFileBytes: 4096, maxImageBytes: 4096, maxTreeEntries: 100, maxSearchResults: 20,
  };
  const policy = new PathPolicy(root, config);
  const repository = await repositoryInfo(root, root);
  assert.ok(repository);
  const rootEntries = await listBranchTree(policy, root, repository, "feature/docs", "");
  assert.ok(rootEntries.some((entry) => entry.name === "notes" && entry.type === "directory"));
  const document = await readBranchDocument(policy, root, repository, "feature/docs", "notes/feature.md");
  assert.match(document.content, /Feature branch/);
  const image = await readBranchImage(policy, root, repository, "feature/docs", "notes/preview.png");
  assert.equal(image.mimeType, "image/png");
  assert.deepEqual(image.buffer, png);
  assert.equal((await repositoryInfo(root, root))?.branch, "main");
});
