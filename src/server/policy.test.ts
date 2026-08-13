import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PortalConfig } from "../shared/contracts.js";
import { PathPolicy } from "./policy.js";

const config: PortalConfig = {
  title: "Test",
  roots: [{ path: "projects", label: "Projects", kind: "projects" }],
  excludeSegments: [".git", ".cache", "node_modules"],
  allowedExtensions: [".md", ".ts", ".yml"],
  allowedNames: ["Dockerfile"],
  maxFileBytes: 1024,
  maxImageBytes: 5 * 1024 * 1024,
  maxTreeEntries: 100,
  maxSearchResults: 10,
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-portal-"));
  await mkdir(path.join(root, "projects", "demo"), { recursive: true });
  await writeFile(path.join(root, "projects", "demo", "README.md"), "# Demo");
  return { root, policy: new PathPolicy(root, config) };
}

test("allows configured text files", async () => {
  const { policy } = await fixture();
  const resolved = await policy.resolve("projects/demo/README.md", "file");
  assert.equal(resolved.relative, "projects/demo/README.md");
});

test("allows useful dot-directories while keeping configured internals excluded", async () => {
  const { root, policy } = await fixture();
  await mkdir(path.join(root, "projects", "demo", ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, "projects", "demo", ".github", "workflows", "verify.yml"), "name: Verify");
  await mkdir(path.join(root, "projects", "demo", ".git"), { recursive: true });
  await mkdir(path.join(root, "projects", "demo", ".cache"), { recursive: true });
  await mkdir(path.join(root, "projects", "demo", ".secrets"), { recursive: true });

  const workflow = await policy.resolve("projects/demo/.github/workflows/verify.yml", "file");
  assert.equal(workflow.relative, "projects/demo/.github/workflows/verify.yml");
  await assert.rejects(policy.resolve("projects/demo/.git", "directory"), { code: "PATH_DENIED" });
  await assert.rejects(policy.resolve("projects/demo/.cache", "directory"), { code: "PATH_DENIED" });
  await assert.rejects(policy.resolve("projects/demo/.secrets", "directory"), { code: "PATH_DENIED" });
});

test("rejects traversal and sensitive filenames", async () => {
  const { root, policy } = await fixture();
  await writeFile(path.join(root, "projects", "demo", "api-token.md"), "secret");
  await assert.rejects(policy.resolve("../etc/passwd"), { code: "PATH_DENIED" });
  await assert.rejects(policy.resolve("projects/demo/api-token.md"), { code: "PATH_DENIED" });
});

test("rejects symlinks escaping configured roots", async () => {
  const { root, policy } = await fixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "workspace-outside-"));
  await writeFile(path.join(outside, "README.md"), "outside");
  await symlink(outside, path.join(root, "projects", "outside"));
  await assert.rejects(policy.resolve("projects/outside/README.md"), { code: "PATH_DENIED" });
});
