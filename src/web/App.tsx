import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { FileDocument, PortalRoot, ProjectSummary, RepositoryInfo, SearchResult, TreeEntry } from "../shared/contracts";
import { api } from "./api";

type View = { kind: "home" } | { kind: "directory"; path: string } | { kind: "file"; path: string };
type BranchView = { repository: RepositoryInfo; branch: string };

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  return undefined;
}

function relativeDocumentPath(currentPath: string, href: string | undefined): string | null {
  if (!href || href.startsWith("#") || safeHref(href)) return null;
  try {
    const baseDirectory = currentPath.split("/").slice(0, -1).join("/");
    const resolved = new URL(href, `https://workspace.invalid/${baseDirectory}/`);
    return decodeURIComponent(resolved.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

function breadcrumbs(path: string): Array<{ label: string; path: string }> {
  const parts = path.split("/").filter(Boolean);
  return parts.map((label, index) => ({ label, path: parts.slice(0, index + 1).join("/") }));
}

const FILE_TYPES: Record<string, { label: string; tone: string }> = {
  ".md": { label: "MD", tone: "file-markdown" },
  ".mdx": { label: "MD", tone: "file-markdown" },
  ".ts": { label: "TS", tone: "typescript" },
  ".tsx": { label: "TX", tone: "typescript" },
  ".js": { label: "JS", tone: "javascript" },
  ".jsx": { label: "JX", tone: "javascript" },
  ".mjs": { label: "JS", tone: "javascript" },
  ".cjs": { label: "JS", tone: "javascript" },
  ".json": { label: "{}", tone: "json" },
  ".jsonc": { label: "{}", tone: "json" },
  ".yaml": { label: "Y", tone: "yaml" },
  ".yml": { label: "Y", tone: "yaml" },
  ".html": { label: "<>", tone: "html" },
  ".css": { label: "#", tone: "css" },
  ".scss": { label: "S", tone: "css" },
  ".vue": { label: "V", tone: "vue" },
  ".cs": { label: "C#", tone: "dotnet" },
  ".csproj": { label: "C#", tone: "dotnet" },
  ".sln": { label: "SL", tone: "dotnet" },
  ".sql": { label: "DB", tone: "sql" },
  ".py": { label: "PY", tone: "python" },
  ".sh": { label: ">_", tone: "shell" },
  ".ps1": { label: "PS", tone: "shell" },
  ".xml": { label: "X", tone: "xml" },
  ".toml": { label: "T", tone: "config" },
  ".pdf": { label: "PDF", tone: "pdf" },
};

function FileTypeIcon({ entry }: { entry: TreeEntry }) {
  if (entry.type === "directory") return <span className="folder-icon" aria-hidden="true"><i /><b /></span>;
  const docker = entry.name.toLowerCase().includes("dockerfile");
  const type = docker ? { label: "DK", tone: "docker" } : FILE_TYPES[entry.extension ?? ""] ?? { label: "•", tone: "generic" };
  return <span className={`type-icon ${type.tone}`} aria-label={`${entry.extension || "archivo"}`}><span>{type.label}</span></span>;
}

export function App() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [title, setTitle] = useState("Workspace Portal");
  const [roots, setRoots] = useState<PortalRoot[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [document, setDocument] = useState<FileDocument | null>(null);
  const [repository, setRepository] = useState<RepositoryInfo | null>(null);
  const [branchView, setBranchView] = useState<BranchView | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.config(), api.projects()])
      .then(([config, projectList]) => { setTitle(config.title); setRoots(config.roots); setProjects(projectList); })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setError(null);
    setDocument(null);
    setEntries([]);
    const inSelectedRepository = branchView && view.kind !== "home"
      && (view.path === branchView.repository.path || view.path.startsWith(`${branchView.repository.path}/`));
    if (view.kind === "directory") {
      setLoading(true);
      if (inSelectedRepository) {
        const relative = view.path.slice(branchView.repository.path.length).replace(/^\/+/, "");
        setRepository(branchView.repository);
        api.gitTree(branchView.repository.path, branchView.branch, relative)
          .then(setEntries).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
      } else {
        setBranchView(null);
        Promise.all([api.tree(view.path), api.repository(view.path).catch(() => null)])
          .then(([tree, repo]) => { setEntries(tree); setRepository(repo); })
          .catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
      }
    } else if (view.kind === "file") {
      if (inSelectedRepository) {
        const relative = view.path.slice(branchView.repository.path.length).replace(/^\/+/, "");
        setRepository(branchView.repository);
        setLoading(true);
        api.gitFile(branchView.repository.path, branchView.branch, relative)
          .then(setDocument).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
      } else if (view.path.toLowerCase().endsWith(".pdf")) {
        setBranchView(null);
        api.repository(view.path).then(setRepository).catch(() => setRepository(null));
        setLoading(false);
        return;
      } else {
        setBranchView(null);
        setLoading(true);
        api.file(view.path).then((file) => { setDocument(file); setRepository(file.repository); })
          .catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
      }
    } else {
      setRepository(null);
      setBranchView(null);
    }
  }, [view, branchView?.branch, branchView?.repository.path]);

  const currentPath = view.kind === "home" ? "" : view.path;
  const crumbs = useMemo(() => breadcrumbs(currentPath), [currentPath]);

  async function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    if (search.trim().length < 2) return;
    setBranchView(null);
    setRepository(null);
    setLoading(true);
    setError(null);
    try { setSearchResults(await api.search(search)); } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }

  function openEntry(entry: TreeEntry) {
    setSearchResults(null);
    setView(entry.type === "directory" ? { kind: "directory", path: entry.path } : { kind: "file", path: entry.path });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => { setView({ kind: "home" }); setSearchResults(null); }}>
          <span className="brand-mark">W</span>
          <span><strong>{title}</strong><small>read-only explorer</small></span>
        </button>

        <nav aria-label="Raíces visibles">
          <p className="nav-label">Navegación</p>
          {roots.map((root) => (
            <button key={root.path} onClick={() => setView(root.kind === "document" ? { kind: "file", path: root.path } : { kind: "directory", path: root.path })}>
              <span>{root.kind === "projects" ? "◇" : root.kind === "knowledge" ? "◎" : "□"}</span>{root.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="status-dot" /> Sólo lectura
          <small>Las rutas sensibles están fuera del catálogo.</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            <button onClick={() => setView({ kind: "home" })}>Workspace</button>
            {crumbs.map((crumb, index) => (
              <span key={crumb.path}>/<button onClick={() => setView(index === crumbs.length - 1 && view.kind === "file" ? view : { kind: "directory", path: crumb.path })}>{crumb.label}</button></span>
            ))}
          </div>
          <form className="search" onSubmit={submitSearch}>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en rutas visibles…" aria-label="Buscar" />
            <kbd>↵</kbd>
          </form>
        </header>

        <section className="content">
          {!searchResults && repository && view.kind !== "home" && (
            <aside className="repo-panel">
              <p>Repositorio</p>
              <strong>{repository.path.split("/").at(-1)}</strong>
              <small>Ramas locales</small>
              <div>
                {repository.localBranches.map((branch) => (
                  <button
                    className={(branchView?.branch ?? repository.branch) === branch ? "active" : ""}
                    key={branch}
                    onClick={() => {
                      setBranchView(branch === repository.branch ? null : { repository, branch });
                      setView({ kind: "directory", path: repository.path });
                    }}
                  >
                    <span>{branch === repository.branch ? "●" : "○"}</span>{branch}
                  </button>
                ))}
              </div>
              {branchView && <em>Vista de rama · sin modificar el working tree</em>}
            </aside>
          )}
          {error && <div className="alert">{error}</div>}
          {loading && <div className="loading"><span />Leyendo workspace…</div>}

          {!loading && searchResults && (
            <div>
              <div className="section-heading"><div><p>Resultados</p><h1>“{search}”</h1></div><span>{searchResults.length} coincidencias</span></div>
              <div className="results">
                {searchResults.map((result) => (
                  <button key={`${result.path}:${result.line}`} onClick={() => setView({ kind: "file", path: result.path })}>
                    <strong>{result.name}<span>:{result.line}</span></strong><small>{result.path}</small><code>{result.excerpt}</code>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!loading && !searchResults && view.kind === "home" && (
            <div>
              <div className="hero">
                <p>LOCAL KNOWLEDGE, ONE PLACE</p>
                <h1>Todo tu workspace.<br /><em>Sin perder el contexto.</em></h1>
                <span>Proyectos, repositorios y conocimiento operativo navegables desde una única vista segura.</span>
              </div>
              <div className="section-heading"><div><p>Catálogo</p><h2>Proyectos</h2></div><span>{projects.length} espacios</span></div>
              <div className="project-grid">
                {projects.map((project) => (
                  <article key={project.path} className="project-card">
                    <button className="project-open" onClick={() => setView({ kind: "directory", path: project.path })}>
                      <span className="project-icon">{project.name.slice(0, 2).toUpperCase()}</span>
                      <h3>{project.name}</h3>
                      <p>{project.description ?? "Explorar archivos, documentación y repositorios."}</p>
                    </button>
                    <footer>
                      <span>{project.repositories.length} repo{project.repositories.length === 1 ? "" : "s"}</span>
                      {project.repositories[0]?.webUrl && <a href={project.repositories[0].webUrl} target="_blank" rel="noreferrer">GitHub ↗</a>}
                    </footer>
                  </article>
                ))}
              </div>
            </div>
          )}

          {!loading && !searchResults && view.kind === "directory" && (
            <div>
              <div className="section-heading"><div><p>Directorio</p><h1>{view.path.split("/").at(-1)}</h1></div><span>{entries.length} elementos</span></div>
              <div className="file-list">
                {entries.map((entry) => (
                  <button key={entry.path} onClick={() => openEntry(entry)}>
                    <FileTypeIcon entry={entry} />
                    <span><strong>{entry.name}</strong><small>{entry.type === "directory" ? "Directorio" : entry.extension || "Archivo"}</small></span>
                    <i>›</i>
                  </button>
                ))}
                {entries.length === 0 && <div className="empty">No hay archivos visibles en este directorio.</div>}
              </div>
            </div>
          )}

          {!loading && !searchResults && document && (
            <article className="document">
              <div className="document-header">
                <div><p>{document.extension || "archivo"}</p><h1>{document.name}</h1><small>{document.path}</small></div>
                {document.repository?.webUrl && <a href={document.repository.webUrl} target="_blank" rel="noreferrer">Abrir repositorio ↗</a>}
              </div>
              {document.truncated && <div className="alert">Vista truncada por el límite de tamaño seguro.</div>}
              {document.extension === ".md" || document.extension === ".mdx" ? (
                <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ href, children }) => {
                  const external = safeHref(href);
                  const internal = relativeDocumentPath(document.path, href);
                  if (external) return <a href={external} target="_blank" rel="noreferrer">{children}</a>;
                  if (internal) return <a href={`#${internal}`} onClick={(event) => { event.preventDefault(); setView({ kind: "file", path: internal }); }}>{children}</a>;
                  return <span>{children}</span>;
                } }}>{document.content}</ReactMarkdown></div>
              ) : <pre className="source"><code>{document.content}</code></pre>}
            </article>
          )}
          {!loading && !searchResults && !branchView && view.kind === "file" && view.path.toLowerCase().endsWith(".pdf") && (
            <article className="document pdf-document">
              <div className="document-header">
                <div><p>.pdf</p><h1>{view.path.split("/").at(-1)}</h1><small>{view.path}</small></div>
                <a href={`/api/raw?path=${encodeURIComponent(view.path)}`} target="_blank" rel="noreferrer">Abrir PDF ↗</a>
              </div>
              <iframe title={view.path} src={`/api/raw?path=${encodeURIComponent(view.path)}`} />
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
