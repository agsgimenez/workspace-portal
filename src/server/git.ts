import { access, opendir, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import type { FileDocument, RepositoryInfo, TreeEntry } from "../shared/contracts.js";
import { PortalError } from "./errors.js";
import { isImageExtension, validatedImageMimeType } from "./images.js";
import type { PathPolicy } from "./policy.js";

async function exists(candidate: string): Promise<boolean> {
  try { await access(candidate); return true; } catch { return false; }
}

function configValue(config: string, section: string, key: string): string | null {
  let active = "";
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) active = line.slice(1, -1);
    if (active === section) {
      const match = line.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "i"));
      if (match) return match[1].trim();
    }
  }
  return null;
}

export function remoteToWebUrl(remote: string | null): string | null {
  if (!remote) return null;
  const ssh = remote.match(/^git@([^:]+):(.+)$/);
  const sshUrl = remote.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  const https = remote.match(/^https?:\/\/([^/]+)\/(.+)$/);
  const match = ssh ?? sshUrl ?? https;
  if (!match) return null;
  const repository = match[2].replace(/\.git$/, "");
  return `https://${match[1]}/${repository}`;
}

async function resolveGitDir(repositoryRoot: string): Promise<string | null> {
  const marker = path.join(repositoryRoot, ".git");
  if (!(await exists(marker))) return null;
  if ((await stat(marker)).isDirectory()) return marker;
  const content = await readFile(marker, "utf8");
  const match = content.match(/^gitdir:\s*(.+)$/m);
  return match ? path.resolve(repositoryRoot, match[1].trim()) : null;
}

async function branchFromHead(gitDir: string): Promise<string | null> {
  const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
  const match = head.match(/^ref:\s+refs\/heads\/(.+)$/);
  return match ? match[1] : head.slice(0, 12) || null;
}

async function commonGitDir(gitDir: string): Promise<string> {
  try {
    const common = (await readFile(path.join(gitDir, "commondir"), "utf8")).trim();
    return path.resolve(gitDir, common);
  } catch {
    return gitDir;
  }
}

async function localBranches(gitDir: string): Promise<string[]> {
  const commonDir = await commonGitDir(gitDir);
  const branches = new Set<string>();
  const headsDir = path.join(commonDir, "refs", "heads");

  async function visit(directory: string, prefix = ""): Promise<void> {
    let handle;
    try { handle = await opendir(directory); } catch { return; }
    for await (const entry of handle) {
      if (branches.size >= 200) return;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name);
      else if (entry.isFile()) branches.add(name);
    }
  }

  await visit(headsDir);
  try {
    const packed = await readFile(path.join(commonDir, "packed-refs"), "utf8");
    for (const line of packed.split(/\r?\n/)) {
      const match = line.match(/^[0-9a-f]+ refs\/heads\/(.+)$/i);
      if (match) branches.add(match[1]);
      if (branches.size >= 200) break;
    }
  } catch { /* repositories may have no packed refs */ }

  return [...branches].sort((a, b) => a.localeCompare(b));
}

export async function repositoryInfo(repositoryRoot: string, workspaceRoot: string): Promise<RepositoryInfo | null> {
  try {
    const gitDir = await resolveGitDir(repositoryRoot);
    if (!gitDir) return null;
    const config = await readFile(path.join(gitDir, "config"), "utf8");
    const remote = configValue(config, 'remote "origin"', "url");
    return {
      path: path.relative(workspaceRoot, repositoryRoot).replaceAll(path.sep, "/"),
      branch: await branchFromHead(gitDir),
      localBranches: await localBranches(gitDir),
      remote,
      webUrl: remoteToWebUrl(remote),
      dirty: null,
    };
  } catch {
    // Repository metadata enriches the response but never blocks file access.
    return null;
  }
}

export async function findRepository(start: string, workspaceRoot: string): Promise<RepositoryInfo | null> {
  let current = start;
  while (current === workspaceRoot || current.startsWith(`${workspaceRoot}${path.sep}`)) {
    const info = await repositoryInfo(current, workspaceRoot);
    if (info) return info;
    if (current === workspaceRoot) break;
    current = path.dirname(current);
  }
  return null;
}

function normalizeBranchPath(input: unknown): string {
  if (typeof input !== "string" || input.includes("\0") || input.includes("\\") || input.includes(":")) {
    throw new PortalError("Invalid branch path", 400, "INVALID_PATH");
  }
  const normalized = path.posix.normalize(input.replace(/^\/+/, ""));
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new PortalError("Branch path escapes the repository", 403, "PATH_DENIED");
  }
  return normalized === "." ? "" : normalized;
}

function runGit(repositoryRoot: string, args: string[], maxBuffer: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-c", "safe.directory=*", "-C", repositoryRoot, ...args], {
      encoding: "buffer",
      maxBuffer,
      timeout: 5000,
      env: { PATH: process.env.PATH, GIT_OPTIONAL_LOCKS: "0", LANG: "C" },
    }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function requireLocalBranch(repository: RepositoryInfo, branch: unknown): string {
  if (typeof branch !== "string" || !repository.localBranches.includes(branch)) {
    throw new PortalError("Unknown local branch", 404, "BRANCH_NOT_FOUND");
  }
  return branch;
}

export async function listBranchTree(
  policy: PathPolicy,
  repositoryRoot: string,
  repository: RepositoryInfo,
  branchInput: unknown,
  pathInput: unknown,
): Promise<TreeEntry[]> {
  const branch = requireLocalBranch(repository, branchInput);
  const relativePath = normalizeBranchPath(pathInput);
  const treeish = relativePath ? `${branch}:${relativePath}` : branch;
  let output: Buffer;
  try {
    output = await runGit(repositoryRoot, ["ls-tree", "-z", treeish], 4 * 1024 * 1024);
  } catch {
    throw new PortalError("Directory not found in branch", 404, "NOT_FOUND");
  }
  const entries: TreeEntry[] = [];
  for (const record of output.toString("utf8").split("\0")) {
    if (!record || entries.length >= policy.config.maxTreeEntries) continue;
    const match = record.match(/^\d+ (blob|tree) [0-9a-f]+\t([\s\S]+)$/);
    if (!match) continue;
    const name = match[2];
    const workspacePath = path.posix.join(repository.path, relativePath, name);
    if (policy.isExcluded(workspacePath) || (match[1] === "blob" && !policy.isAllowedFile(workspacePath))) continue;
    entries.push({
      name,
      path: workspacePath,
      type: match[1] === "tree" ? "directory" : "file",
      extension: match[1] === "blob" ? path.posix.extname(name).toLowerCase() : undefined,
    });
  }
  return entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
}

export async function readBranchDocument(
  policy: PathPolicy,
  repositoryRoot: string,
  repository: RepositoryInfo,
  branchInput: unknown,
  pathInput: unknown,
): Promise<FileDocument> {
  const branch = requireLocalBranch(repository, branchInput);
  const relativePath = normalizeBranchPath(pathInput);
  const workspacePath = path.posix.join(repository.path, relativePath);
  if (!relativePath || !policy.isAllowedFile(workspacePath)) {
    throw new PortalError("File type is not visible", 403, "FILE_DENIED");
  }
  if (isImageExtension(relativePath)) throw new PortalError("Binary files are not rendered as text", 415, "BINARY_FILE");
  let objectId: string;
  try {
    const tree = await runGit(repositoryRoot, ["ls-tree", "-z", branch, "--", relativePath], 1024 * 1024);
    const match = tree.toString("utf8").match(/^\d+ blob ([0-9a-f]+)\t/);
    if (!match) throw new Error("not a blob");
    objectId = match[1];
  } catch {
    throw new PortalError("File not found in branch", 404, "NOT_FOUND");
  }
  let buffer: Buffer;
  try {
    buffer = await runGit(repositoryRoot, ["cat-file", "blob", objectId], policy.config.maxFileBytes + 1);
  } catch {
    throw new PortalError("File exceeds the preview limit", 413, "FILE_TOO_LARGE");
  }
  if (buffer.includes(0)) throw new PortalError("Binary files are not rendered", 415, "BINARY_FILE");
  const truncated = buffer.length > policy.config.maxFileBytes;
  return {
    path: workspacePath,
    name: path.posix.basename(relativePath),
    extension: path.posix.extname(relativePath).toLowerCase(),
    content: buffer.subarray(0, policy.config.maxFileBytes).toString("utf8"),
    truncated,
    repository,
  };
}

export async function readBranchImage(
  policy: PathPolicy,
  repositoryRoot: string,
  repository: RepositoryInfo,
  branchInput: unknown,
  pathInput: unknown,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const branch = requireLocalBranch(repository, branchInput);
  const relativePath = normalizeBranchPath(pathInput);
  const workspacePath = path.posix.join(repository.path, relativePath);
  if (!relativePath || !policy.isAllowedFile(workspacePath) || !isImageExtension(relativePath)) {
    throw new PortalError("Image type is not visible", 403, "FILE_DENIED");
  }

  let objectId: string;
  try {
    const tree = await runGit(repositoryRoot, ["ls-tree", "-z", branch, "--", relativePath], 1024 * 1024);
    const match = tree.toString("utf8").match(/^\d+ blob ([0-9a-f]+)\t/);
    if (!match) throw new Error("not a blob");
    objectId = match[1];
  } catch {
    throw new PortalError("Image not found in branch", 404, "NOT_FOUND");
  }

  let buffer: Buffer;
  try {
    buffer = await runGit(repositoryRoot, ["cat-file", "blob", objectId], policy.config.maxImageBytes + 1);
  } catch {
    throw new PortalError("Image exceeds the preview limit", 413, "FILE_TOO_LARGE");
  }
  if (buffer.length > policy.config.maxImageBytes) {
    throw new PortalError("Image exceeds the preview limit", 413, "FILE_TOO_LARGE");
  }

  return { buffer, mimeType: validatedImageMimeType(relativePath, buffer.subarray(0, 12)) };
}
