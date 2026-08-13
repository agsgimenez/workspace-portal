import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { PortalConfig } from "../shared/contracts.js";
import { PortalError } from "./errors.js";

const SENSITIVE_EXTENSIONS = new Set([".env", ".pem", ".key", ".pfx", ".p12", ".kdbx", ".sqlite", ".db"]);
const SENSITIVE_NAMES = /(^|[._-])(secret|secrets|credential|credentials|token|password|passwd|auth)([._-]|$)/i;
const SENSITIVE_SEGMENTS = new Set([".env", ".git", ".ssh", ".gnupg", ".aws", ".kube", ".docker"]);

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export class PathPolicy {
  private readonly configuredRoots: string[];

  constructor(
    readonly workspaceRoot: string,
    readonly config: PortalConfig,
  ) {
    this.configuredRoots = config.roots.map((root) => path.resolve(workspaceRoot, root.path));
  }

  normalize(input: unknown): string {
    if (typeof input !== "string" || input.includes("\0") || input.includes("\\")) {
      throw new PortalError("Invalid path", 400, "INVALID_PATH");
    }
    const normalized = path.posix.normalize(input.replace(/^\/+/, ""));
    if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
      throw new PortalError("Path escapes the workspace", 403, "PATH_DENIED");
    }
    return normalized === "." ? "" : normalized;
  }

  isConfigured(relativePath: string): boolean {
    const absolute = path.resolve(this.workspaceRoot, relativePath);
    return this.configuredRoots.some((root) => inside(root, absolute) || inside(absolute, root));
  }

  isExcluded(relativePath: string): boolean {
    const segments = relativePath.split("/").filter(Boolean);
    return segments.some((segment) =>
      this.config.excludeSegments.includes(segment)
      || SENSITIVE_SEGMENTS.has(segment.toLowerCase())
      || SENSITIVE_NAMES.test(segment),
    );
  }

  isAllowedFile(relativePath: string): boolean {
    const name = path.posix.basename(relativePath);
    const extension = path.posix.extname(name).toLowerCase();
    if (this.isExcluded(relativePath) || SENSITIVE_EXTENSIONS.has(extension) || SENSITIVE_NAMES.test(name)) return false;
    return this.config.allowedExtensions.includes(extension) || this.config.allowedNames.includes(name);
  }

  async resolve(input: unknown, expected?: "file" | "directory"): Promise<{ relative: string; absolute: string }> {
    const relative = this.normalize(input);
    if (!this.isConfigured(relative) || this.isExcluded(relative)) {
      throw new PortalError("Path is outside the visible catalog", 403, "PATH_DENIED");
    }

    const candidate = path.resolve(this.workspaceRoot, relative);
    let resolved: string;
    try {
      resolved = await realpath(candidate);
    } catch {
      throw new PortalError("Path not found", 404, "NOT_FOUND");
    }

    const allowedByRealPath = this.configuredRoots.some((root) => inside(root, resolved) || inside(resolved, root));
    if (!inside(this.workspaceRoot, resolved) || !allowedByRealPath) {
      throw new PortalError("Symbolic link escapes the visible catalog", 403, "PATH_DENIED");
    }

    const stats = await lstat(resolved);
    if (expected === "file" && !stats.isFile()) throw new PortalError("Expected a file", 400, "INVALID_TYPE");
    if (expected === "directory" && !stats.isDirectory()) throw new PortalError("Expected a directory", 400, "INVALID_TYPE");
    if (stats.isFile() && !this.isAllowedFile(relative)) throw new PortalError("File type is not visible", 403, "FILE_DENIED");

    return { relative, absolute: resolved };
  }
}
