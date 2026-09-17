import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { WorkItem, WorkSnapshot } from "../shared/contracts.js";
import { PortalError } from "./errors.js";
import { PathPolicy } from "./policy.js";

const SNAPSHOT_PATH = "ai-space/data/workspace-backlog.json";
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS = 500;
const STATUSES = new Set(["unclassified", "open", "in_progress", "blocked", "review", "done"]);

function invalid(): never {
  throw new PortalError("Backlog snapshot is invalid", 500, "INVALID_WORK_SNAPSHOT");
}

function boundedString(value: unknown, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) invalid();
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null) return null;
  return boundedString(value);
}

function timestamp(value: unknown): string {
  const text = boundedString(value, 64);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(text) || Number.isNaN(Date.parse(text))) invalid();
  return text;
}

function sourcePath(value: unknown): string {
  const text = boundedString(value, 1024);
  if (text.startsWith("/") || text.includes("\\") || text.split("/").some((part) => !part || part === "." || part === "..")) invalid();
  return text;
}

export async function readWorkSnapshot(policy: PathPolicy): Promise<WorkSnapshot> {
  const absolute = path.join(policy.workspaceRoot, SNAPSHOT_PATH);
  let raw: unknown;
  try {
    for (const relative of ["ai-space", "ai-space/data"]) {
      const directory = path.join(policy.workspaceRoot, relative);
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) invalid();
    }
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) invalid();
      raw = JSON.parse(await file.readFile("utf8"));
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new PortalError("Backlog snapshot is not available yet", 404, "WORK_SNAPSHOT_MISSING");
    }
    if (error instanceof PortalError) throw error;
    invalid();
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
  const data = raw as Record<string, unknown>;
  if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > MAX_ITEMS) invalid();
  const ids = new Set<string>();
  const items: WorkItem[] = [];
  for (const entry of data.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid();
    const item = entry as Record<string, unknown>;
    const id = boundedString(item.id, 120);
    if (ids.has(id)) invalid();
    ids.add(id);
    const source = sourcePath(item.sourcePath);
    const expectedHref = `?view=file&path=${encodeURIComponent(source)}`;
    if (typeof item.href !== "string" || !item.href.trim()) invalid();
    const incomingStatus = boundedString(item.status, 80);
    if (!STATUSES.has(incomingStatus)) invalid();
    const unclassifiedId = id.startsWith("LEGACY-") || id.startsWith("CANDIDATE-");
    // Compatibilidad de lectura durante el despliegue del nuevo export de Core.
    const status = id.startsWith("LEGACY-") && incomingStatus === "open" ? "unclassified" : incomingStatus;
    if (unclassifiedId !== (status === "unclassified")) invalid();
    try {
      await policy.resolve(source, "file");
    } catch { invalid(); }
    items.push({
      id,
      project: boundedString(item.project, 120),
      title: boundedString(item.title),
      status,
      nextAction: optionalString(item.nextAction),
      blocker: optionalString(item.blocker),
      owner: optionalString(item.owner),
      updatedAt: timestamp(item.updatedAt),
      sourcePath: source,
      href: expectedHref,
    });
  }
  return { version: 1, generatedAt: timestamp(data.generatedAt), items };
}
