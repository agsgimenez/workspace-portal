import { opendir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectSummary, RepositoryInfo } from "../shared/contracts.js";
import { PathPolicy } from "./policy.js";
import { repositoryInfo } from "./git.js";

const MAX_REPOSITORIES_PER_PROJECT = 100;
const REPOSITORY_SCAN_DEPTH = 5;

async function descriptionFor(directory: string): Promise<string | null> {
  for (const name of ["README.md", "readme.md"]) {
    try {
      const content = await readFile(path.join(directory, name), "utf8");
      const lines = content.split(/\r?\n/).map((line) => line.trim());
      return lines.find((line) => line
        && !line.startsWith("#")
        && !line.startsWith("[")
        && !line.startsWith("!")
        && !line.startsWith("<")
        && !line.startsWith("```")
        && !line.startsWith(">"))?.slice(0, 240) ?? null;
    } catch { /* try next name */ }
  }
  return null;
}

async function scanRepositories(
  directory: string,
  policy: PathPolicy,
  depth = 0,
  found: RepositoryInfo[] = [],
): Promise<RepositoryInfo[]> {
  if (found.length >= MAX_REPOSITORIES_PER_PROJECT || depth > REPOSITORY_SCAN_DEPTH) return found;
  const repo = await repositoryInfo(directory, policy.workspaceRoot);
  if (repo) {
    found.push(repo);
    return found;
  }

  let handle;
  try { handle = await opendir(directory); } catch { return found; }
  for await (const entry of handle) {
    if (!entry.isDirectory()) continue;
    const relative = path.relative(policy.workspaceRoot, path.join(directory, entry.name)).replaceAll(path.sep, "/");
    if (policy.isExcluded(relative)) continue;
    await scanRepositories(path.join(directory, entry.name), policy, depth + 1, found);
    if (found.length >= MAX_REPOSITORIES_PER_PROJECT) break;
  }
  return found;
}

export async function listProjects(policy: PathPolicy): Promise<ProjectSummary[]> {
  const projects: ProjectSummary[] = [];
  for (const root of policy.config.roots.filter((item) => item.kind === "projects")) {
    const resolved = await policy.resolve(root.path, "directory");
    const handle = await opendir(resolved.absolute);
    for await (const entry of handle) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const absolute = path.join(resolved.absolute, entry.name);
      const relative = path.relative(policy.workspaceRoot, absolute).replaceAll(path.sep, "/");
      if (policy.isExcluded(relative)) continue;
      projects.push({
        name: entry.name,
        path: relative,
        description: await descriptionFor(absolute),
        repositories: await scanRepositories(absolute, policy),
      });
    }
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}
