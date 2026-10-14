import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Download, RefreshCw, Upload, FilePlus, Save, Trash2, GitCommit } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getGitCredentials, saveRepoUrl } from "@/lib/workspace/workspace.functions";
import type { RepoStatus } from "@/lib/workspace/git";

export const Route = createFileRoute("/_authenticated/workspace/git")({
  head: () => ({
    meta: [
      { title: "Git Manager — App Forge Workspace" },
      { name: "description", content: "Clone, edit, pull and push Git repositories in your browser." },
      { property: "og:title", content: "Git Manager — App Forge Workspace" },
      { property: "og:description", content: "Clone, edit, pull and push Git repositories in your browser." },
    ],
  }),
  component: GitPage,
});

function GitPage() {
  const credsFn = useServerFn(getGitCredentials);
  const saveUrlFn = useServerFn(saveRepoUrl);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [newPath, setNewPath] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  const log = useCallback((l: string) => {
    setLogs((x) => [...x.slice(-400), `[${new Date().toLocaleTimeString()}] ${l}`]);
  }, []);
  useEffect(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }), [logs]);

  const refresh = useCallback(async () => {
    const g = await import("@/lib/workspace/git");
    setStatus((await g.hasRepo()) ? await g.repoStatus() : null);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    credsFn()
      .then((c) => c.repoUrl && setUrl((u) => u || c.repoUrl))
      .catch(() => {});
  }, [credsFn, refresh]);

  async function auth() {
    const [c, s] = await Promise.all([credsFn(), supabase.auth.getSession()]);
    if (!s.data.session) throw new Error("Please sign in again");
    return { token: c.token, appToken: s.data.session.access_token, name: c.authorName, email: c.authorEmail };
  }

  async function run(label: string, fn: () => Promise<void>, success: string) {
    setRunning(label);
    log(`▶ ${label}`);
    try {
      await fn();
      toast.success(success);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      log(`✖ ${m}`);
      toast.error(`${label} failed: ${m}`);
    } finally {
      setRunning(null);
      refresh().catch(() => {});
    }
  }

  const clone = () =>
    run("Clone", async () => {
      if (!/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//.test(url)) throw new Error("Use an https GitHub, GitLab or Bitbucket URL");
      const g = await import("@/lib/workspace/git");
      await g.cloneRepo(url.trim(), await auth(), log);
      setFile(null);
      saveUrlFn({ data: { repoUrl: url.trim() } }).catch(() => {});
    }, "Repository cloned");

  const pull = () =>
    run("Pull", async () => {
      const g = await import("@/lib/workspace/git");
      await g.pullRepo(await auth(), log);
    }, "Pulled latest changes");

  const push = () =>
    run("Commit & push", async () => {
      if (!msg.trim()) throw new Error("Write a commit message first");
      const a = await auth();
      if (!a.token) throw new Error("Add a GitHub token in Settings to push");
      const g = await import("@/lib/workspace/git");
      await g.commitAndPush(msg.trim(), a, log);
      setMsg("");
    }, "Changes pushed");

  async function open(path: string) {
    try {
      const g = await import("@/lib/workspace/git");
      setContent(await g.readRepoFile(path));
      setFile(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Can't open file");
    }
  }
  async function save() {
    if (!file) return;
    const g = await import("@/lib/workspace/git");
    await g.writeRepoFile(file, content);
    toast.success(`Saved ${file}`);
    log(`edited: ${file}`);
    refresh();
  }
  async function create() {
    const p = newPath.trim().replace(/^\/+/, "");
    if (!p || p.includes("..")) return toast.error("Enter a valid file path");
    const g = await import("@/lib/workspace/git");
    await g.writeRepoFile(p, "");
    setNewPath("");
    log(`created: ${p}`);
    await refresh();
    open(p);
  }
  async function remove() {
    if (!file || !confirm(`Delete ${file}?`)) return;
    const g = await import("@/lib/workspace/git");
    await g.deleteRepoFile(file);
    log(`deleted: ${file}`);
    setFile(null);
    refresh();
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Git Manager</h1>
      <p className="text-sm text-muted-foreground">
        Repositories are stored in this browser. Private repos and pushing need a token in{" "}
        <Link to="/workspace/settings" className="text-primary underline">Settings</Link>.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/repo.git" />
        <Button onClick={clone} disabled={!!running || !url.trim()}>
          {running === "Clone" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Clone
        </Button>
      </div>

      {status ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-muted px-2 py-0.5">branch: {status.branch ?? "—"}</span>
            <span className="truncate text-muted-foreground">{status.remote}</span>
            <Button size="sm" variant="outline" onClick={pull} disabled={!!running}>
              {running === "Pull" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Pull
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="space-y-2 rounded-xl border p-3">
              <h2 className="font-semibold">Changes ({status.changes.length})</h2>
              {status.changes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Working tree clean.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                  {status.changes.map((c) => (
                    <li key={c.file} className="flex justify-between gap-2">
                      <button className="truncate text-left hover:underline" onClick={() => c.state !== "deleted" && open(c.file)}>{c.file}</button>
                      <span className="text-xs text-muted-foreground">{c.state}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Commit message" />
              <Button className="w-full" onClick={push} disabled={!!running}>
                {running === "Commit & push" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Commit & push
              </Button>
            </section>

            <section className="space-y-2 rounded-xl border p-3">
              <h2 className="font-semibold">Recent commits</h2>
              <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
                {status.log.map((c) => (
                  <li key={c.oid} className="flex gap-2">
                    <GitCommit className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate">{c.message.split("\n")[0]}</div>
                      <div className="text-xs text-muted-foreground">{c.oid.slice(0, 7)} · {c.author} · {c.date}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="space-y-2 rounded-xl border p-3">
            <h2 className="font-semibold">Files</h2>
            <div className="flex gap-2">
              <Input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="new/file/path.md" />
              <Button variant="outline" onClick={create}><FilePlus className="h-4 w-4" /> New</Button>
            </div>
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <ul className="max-h-72 overflow-y-auto text-xs">
                {status.files.map((f) => (
                  <li key={f}>
                    <button onClick={() => open(f)} className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-muted ${f === file ? "bg-muted font-medium" : ""}`}>{f}</button>
                  </li>
                ))}
              </ul>
              {file ? (
                <div className="space-y-2">
                  <div className="truncate text-sm font-medium">{file}</div>
                  <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="h-64 font-mono text-xs" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={save}><Save className="h-4 w-4" /> Save file</Button>
                    <Button size="sm" variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" /> Delete</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Pick a file to view or edit it.</p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No repository cloned yet.</p>
      )}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">Console</h2>
          <Button size="sm" variant="ghost" onClick={() => setLogs([])}>Clear</Button>
        </div>
        <pre ref={logRef} className="h-48 overflow-y-auto rounded-xl bg-muted p-3 text-xs">
          {logs.length ? logs.join("\n") : "Git output will appear here."}
        </pre>
      </section>
    </div>
  );
}
