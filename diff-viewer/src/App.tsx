import { useState, useRef } from "react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import { readTextFile, readDir } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type FileDiff = {
  path: string;
  fullPath: string;
  oldContent: string;
  newContent: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted";
};

type FileEntry = {
  path: string;
  fullPath: string;
  isDir: boolean;
  children?: FileEntry[];
};

const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", ".next", "dist",
  "__pycache__", ".venv", ".cache", "build", "out",
]);

function splitDiffByFile(diffOutput: string): Map<string, string> {
  const result = new Map<string, string>();
  const sections = diffOutput.split(/(?=^diff --git )/m);
  for (const section of sections) {
    if (!section.trim()) continue;
    const match = section.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (match) result.set(match[1].trim(), section);
  }
  return result;
}

function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}

async function readDirRecursive(basePath: string, rel = ""): Promise<FileEntry[]> {
  const fullPath = rel ? `${basePath}/${rel}` : basePath;
  const entries = await readDir(fullPath);
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (!entry.name || SKIP_DIRS.has(entry.name)) continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const entryFull = `${basePath}/${relPath}`;
    if (entry.isDirectory) {
      const children = await readDirRecursive(basePath, relPath);
      result.push({ path: relPath, fullPath: entryFull, isDir: true, children });
    } else {
      result.push({ path: relPath, fullPath: entryFull, isDir: false });
    }
  }
  result.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  return result;
}

// ── File tree ─────────────────────────────────────────────────

function FileTree({
  entries,
  diffs,
  onSelect,
}: {
  entries: FileEntry[];
  diffs: Map<string, FileDiff>;
  onSelect: (e: FileEntry) => void;
}) {
  return (
    <ul className="file-tree">
      {entries.map((e) => (
        <FileTreeItem key={e.path} entry={e} diffs={diffs} onSelect={onSelect} />
      ))}
    </ul>
  );
}

function FileTreeItem({
  entry,
  diffs,
  onSelect,
}: {
  entry: FileEntry;
  diffs: Map<string, FileDiff>;
  onSelect: (e: FileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isChanged = diffs.has(entry.path);

  if (entry.isDir) {
    return (
      <li>
        <button className="tree-item dir" onClick={() => setExpanded((v) => !v)}>
          <span className="tree-icon">{expanded ? "▾" : "▸"}</span>
          <span className="tree-name">{entry.path.split("/").pop()}</span>
        </button>
        {expanded && entry.children && (
          <ul className="tree-children">
            {entry.children.map((c) => (
              <FileTreeItem key={c.path} entry={c} diffs={diffs} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <button
        className={`tree-item file${isChanged ? " changed" : ""}`}
        onClick={() => onSelect(entry)}
        title={entry.path}
      >
        <span className="tree-name">{entry.path.split("/").pop()}</span>
      </button>
    </li>
  );
}

// ── Diff section (collapsible per file) ───────────────────────

function DiffSection({
  diff,
  expanded,
  onToggle,
  containerRef,
}: {
  diff: FileDiff;
  expanded: boolean;
  onToggle: () => void;
  containerRef: (el: HTMLDivElement | null) => void;
}) {
  const ext = diff.path.split(".").pop() ?? "";

  return (
    <div className="diff-section" ref={containerRef}>
      <button className="diff-section-header" onClick={onToggle}>
        <span className="diff-section-toggle">{expanded ? "▾" : "▸"}</span>
        <span className="diff-section-path">{diff.path}</span>
        <span className="diff-section-stats">
          <span className="add-count">+{diff.additions}</span>
          <span className="del-count">−{diff.deletions}</span>
        </span>
      </button>
      {expanded && (
        <div className="diff-section-body">
          <DiffView
            data={{
              oldFile: { fileName: diff.path, fileLang: ext, content: diff.oldContent },
              newFile: { fileName: diff.path, fileLang: ext, content: diff.newContent },
              hunks: [diff.patch],
            }}
            diffViewMode={DiffModeEnum.Unified}
            diffViewTheme="light"
            diffViewHighlight
          />
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────

export default function App() {
  const [folderPath, setFolderPath] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [fileTree, setFileTree] = useState<FileEntry[]>([]);
  const [diffs, setDiffs] = useState<Map<string, FileDiff>>(new Map());
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [isGitRepo, setIsGitRepo] = useState(false);

  const diffRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);

  function toggleFile(path: string) {
    setExpandedFile((prev) => (prev === path ? null : path));
  }

  async function openFolder() {
    const selected = await open({ multiple: false, directory: true });
    if (!selected) return;
    const path = selected as string;
    setFolderPath(path);
    setFolderName(path.split(/[\\/]/).pop() || path);
    setDiffs(new Map());
    setExpandedFile(null);
    setLoading(true);
    setStatus("Reading folder…");
    try {
      const tree = await readDirRecursive(path);
      setFileTree(tree);
      try {
        await invoke("run_git", { args: ["rev-parse", "--git-dir"], cwd: path });
        setIsGitRepo(true);
        setStatus("Ready — click Diff to see git changes.");
      } catch {
        setIsGitRepo(false);
        setStatus("Opened (not a git repo).");
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function runDiff() {
    if (!folderPath || !isGitRepo) return;
    setLoading(true);
    setStatus("Running git diff…");
    const newDiffs = new Map<string, FileDiff>();
    try {
      const diffOutput = await invoke<string>("run_git", {
        args: ["diff", "HEAD", "--unified=3"],
        cwd: folderPath,
      });
      const statusOut = await invoke<string>("run_git", {
        args: ["status", "--short"],
        cwd: folderPath,
      });

      const perFile = splitDiffByFile(diffOutput);
      for (const [relPath, patch] of perFile) {
        const { additions, deletions } = countChanges(patch);
        let oldContent = "";
        let newContent = "";
        try {
          oldContent = await invoke<string>("run_git", {
            args: ["show", `HEAD:${relPath}`],
            cwd: folderPath,
          });
        } catch { /* new file */ }
        try {
          newContent = await readTextFile(`${folderPath}/${relPath}`);
        } catch { /* deleted */ }
        newDiffs.set(relPath, {
          path: relPath,
          fullPath: `${folderPath}/${relPath}`,
          oldContent,
          newContent,
          patch,
          additions,
          deletions,
          status: "modified",
        });
      }

      for (const line of statusOut.split("\n")) {
        if (!line.trim()) continue;
        const code = line.substring(0, 2).trim();
        const filePath = line.substring(3).trim();
        if ((code === "??" || code === "A") && !newDiffs.has(filePath)) {
          let newContent = "";
          try { newContent = await readTextFile(`${folderPath}/${filePath}`); }
          catch { continue; }
          const lines = newContent.split("\n");
          const patch = `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`;
          newDiffs.set(filePath, {
            path: filePath,
            fullPath: `${folderPath}/${filePath}`,
            oldContent: "",
            newContent,
            patch,
            additions: lines.length,
            deletions: 0,
            status: "added",
          });
        }
      }

      setDiffs(newDiffs);
      setExpandedFile(null);
      setStatus(
        newDiffs.size === 0
          ? "No changes detected."
          : `${newDiffs.size} file${newDiffs.size === 1 ? "" : "s"} changed.`
      );
    } catch (e) {
      setStatus(`Git error: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(entry: FileEntry) {
    if (entry.isDir) return;
    if (!diffs.has(entry.path)) return;
    setExpandedFile(entry.path);
    setTimeout(() => {
      diffRefs.current.get(entry.path)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  const diffList = [...diffs.values()];

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-left">
          <button className="btn-open" onClick={openFolder} disabled={loading}>
            Open Folder
          </button>
          {folderPath && (
            <button
              className="btn-diff"
              onClick={runDiff}
              disabled={loading || !isGitRepo}
              title={!isGitRepo ? "Not a git repo" : "Run git diff HEAD"}
            >
              {loading ? "…" : "Diff"}
            </button>
          )}
        </div>

        <span className="folder-name">{folderName || "No folder open"}</span>

        <div className="toolbar-right">
          {status && <span className="status-text">{status}</span>}
        </div>
      </header>

      <div className="body">
        <aside className="sidebar">
          {fileTree.length === 0 ? (
            <p className="sidebar-empty">Open a folder to start</p>
          ) : (
            <FileTree entries={fileTree} diffs={diffs} onSelect={handleSelect} />
          )}
        </aside>

        <main className="content" ref={contentRef}>
          {diffList.length === 0 ? (
            <p className="empty">
              {folderPath
                ? isGitRepo
                  ? "Click Diff to see changes"
                  : "Not a git repo — run git init first"
                : "Open a folder to start"}
            </p>
          ) : (
            <div className="diff-list">
              {diffList.map((diff) => (
                <DiffSection
                  key={diff.path}
                  diff={diff}
                  expanded={expandedFile === diff.path}
                  onToggle={() => toggleFile(diff.path)}
                  containerRef={(el) => {
                    if (el) diffRefs.current.set(diff.path, el);
                    else diffRefs.current.delete(diff.path);
                  }}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
