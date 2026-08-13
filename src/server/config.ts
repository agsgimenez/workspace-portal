import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PortalConfig, PortalRoot, RootKind } from "../shared/contracts.js";
import { PortalError } from "./errors.js";

const ROOT_KINDS = new Set<RootKind>(["document", "projects", "knowledge"]);

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PortalError(`Invalid config field: ${field}`, 500, "INVALID_CONFIG");
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new PortalError(`Invalid config field: ${field}`, 500, "INVALID_CONFIG");
  }
  return Number(value);
}

function parseRoots(value: unknown): PortalRoot[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PortalError("Config requires at least one visible root", 500, "INVALID_CONFIG");
  }

  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new PortalError("Invalid root entry", 500, "INVALID_CONFIG");
    }
    const root = item as Record<string, unknown>;
    if (typeof root.path !== "string" || path.isAbsolute(root.path) || root.path.includes("\0")) {
      throw new PortalError("Root paths must be safe relative paths", 500, "INVALID_CONFIG");
    }
    if (typeof root.label !== "string" || !ROOT_KINDS.has(root.kind as RootKind)) {
      throw new PortalError("Root label or kind is invalid", 500, "INVALID_CONFIG");
    }
    return { path: root.path.replaceAll("\\", "/"), label: root.label, kind: root.kind as RootKind };
  });
}

export async function loadConfig(configPath: string): Promise<PortalConfig> {
  const raw = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  if (typeof raw.title !== "string" || raw.title.trim() === "") {
    throw new PortalError("Config title is required", 500, "INVALID_CONFIG");
  }

  return {
    title: raw.title,
    roots: parseRoots(raw.roots),
    excludeSegments: stringArray(raw.excludeSegments, "excludeSegments"),
    allowedExtensions: stringArray(raw.allowedExtensions, "allowedExtensions").map((item) => item.toLowerCase()),
    allowedNames: stringArray(raw.allowedNames, "allowedNames"),
    maxFileBytes: positiveInteger(raw.maxFileBytes, "maxFileBytes"),
    maxImageBytes: positiveInteger(raw.maxImageBytes ?? 5 * 1024 * 1024, "maxImageBytes"),
    maxTreeEntries: positiveInteger(raw.maxTreeEntries, "maxTreeEntries"),
    maxSearchResults: positiveInteger(raw.maxSearchResults, "maxSearchResults"),
  };
}
