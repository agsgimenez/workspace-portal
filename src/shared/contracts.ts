export type RootKind = "document" | "projects" | "knowledge";

export interface PortalRoot {
  path: string;
  label: string;
  kind: RootKind;
}

export interface PortalConfig {
  title: string;
  roots: PortalRoot[];
  excludeSegments: string[];
  allowedExtensions: string[];
  allowedNames: string[];
  maxFileBytes: number;
  maxImageBytes: number;
  maxTreeEntries: number;
  maxSearchResults: number;
}

export interface TreeEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  extension?: string;
}

export interface RepositoryInfo {
  path: string;
  branch: string | null;
  localBranches: string[];
  remote: string | null;
  webUrl: string | null;
  dirty: boolean | null;
}

export interface ProjectSummary {
  name: string;
  path: string;
  description: string | null;
  repositories: RepositoryInfo[];
}

export interface FileDocument {
  path: string;
  name: string;
  extension: string;
  content: string;
  truncated: boolean;
  repository: RepositoryInfo | null;
}

export interface SearchResult {
  path: string;
  name: string;
  line: number;
  excerpt: string;
}
