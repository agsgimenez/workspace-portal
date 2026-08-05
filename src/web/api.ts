import type { FileDocument, PortalRoot, ProjectSummary, RepositoryInfo, SearchResult, TreeEntry } from "../shared/contracts";

async function get<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  config: () => get<{ title: string; roots: PortalRoot[] }>("/api/config"),
  projects: () => get<ProjectSummary[]>("/api/projects"),
  tree: (path: string) => get<TreeEntry[]>(`/api/tree?path=${encodeURIComponent(path)}`),
  file: (path: string) => get<FileDocument>(`/api/file?path=${encodeURIComponent(path)}`),
  repository: (path: string) => get<RepositoryInfo | null>(`/api/repository?path=${encodeURIComponent(path)}`),
  gitTree: (repo: string, branch: string, path: string) => get<TreeEntry[]>(`/api/git/tree?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`),
  gitFile: (repo: string, branch: string, path: string) => get<FileDocument>(`/api/git/file?repo=${encodeURIComponent(repo)}&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`),
  search: (query: string) => get<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`),
};
