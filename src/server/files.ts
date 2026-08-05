import { opendir, open, stat } from "node:fs/promises";
import path from "node:path";
import type { FileDocument, SearchResult, TreeEntry } from "../shared/contracts.js";
import { PortalError } from "./errors.js";
import { findRepository } from "./git.js";
import { PathPolicy } from "./policy.js";

export async function listTree(policy: PathPolicy, input: unknown): Promise<TreeEntry[]> {
  const target = await policy.resolve(input, "directory");
  const entries: TreeEntry[] = [];
  const handle = await opendir(target.absolute);
  for await (const entry of handle) {
    if (entries.length >= policy.config.maxTreeEntries) break;
    const relative = path.posix.join(target.relative, entry.name);
    if (!policy.isConfigured(relative) || policy.isExcluded(relative)) continue;
    if (entry.isFile() && !policy.isAllowedFile(relative)) continue;
    if (!entry.isFile() && !entry.isDirectory() && !entry.isSymbolicLink()) continue;
    entries.push({
      name: entry.name,
      path: relative,
      type: entry.isDirectory() || entry.isSymbolicLink() ? "directory" : "file",
      extension: entry.isFile() ? path.extname(entry.name).toLowerCase() : undefined,
    });
  }
  return entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1);
}

export async function readDocument(policy: PathPolicy, input: unknown): Promise<FileDocument> {
  const target = await policy.resolve(input, "file");
  const size = (await stat(target.absolute)).size;
  const bytesToRead = Math.min(size, policy.config.maxFileBytes);
  const buffer = Buffer.alloc(bytesToRead);
  const file = await open(target.absolute, "r");
  try { await file.read(buffer, 0, bytesToRead, 0); } finally { await file.close(); }
  if (buffer.includes(0)) throw new PortalError("Binary files are not rendered", 415, "BINARY_FILE");
  return {
    path: target.relative,
    name: path.basename(target.relative),
    extension: path.extname(target.relative).toLowerCase(),
    content: buffer.toString("utf8"),
    truncated: size > bytesToRead,
    repository: await findRepository(path.dirname(target.absolute), policy.workspaceRoot),
  };
}

export async function searchFiles(policy: PathPolicy, queryInput: unknown): Promise<SearchResult[]> {
  if (typeof queryInput !== "string" || queryInput.trim().length < 2 || queryInput.length > 100) {
    throw new PortalError("Search query must contain 2 to 100 characters", 400, "INVALID_QUERY");
  }
  const query = queryInput.trim().toLocaleLowerCase();
  const results: SearchResult[] = [];

  async function visit(relative: string): Promise<void> {
    if (results.length >= policy.config.maxSearchResults) return;
    const target = await policy.resolve(relative);
    const stats = await stat(target.absolute);
    if (stats.isFile()) {
      if (!policy.isAllowedFile(relative) || stats.size > policy.config.maxFileBytes) return;
      if (path.extname(relative).toLowerCase() === ".pdf") return;
      const document = await readDocument(policy, relative);
      for (const [index, line] of document.content.split(/\r?\n/).entries()) {
        if (line.toLocaleLowerCase().includes(query)) {
          results.push({ path: relative, name: path.basename(relative), line: index + 1, excerpt: line.trim().slice(0, 240) });
          if (results.length >= policy.config.maxSearchResults) return;
        }
      }
      return;
    }

    for (const entry of await listTree(policy, relative)) {
      await visit(entry.path);
      if (results.length >= policy.config.maxSearchResults) return;
    }
  }

  for (const root of policy.config.roots) {
    await visit(root.path);
    if (results.length >= policy.config.maxSearchResults) break;
  }
  return results;
}
