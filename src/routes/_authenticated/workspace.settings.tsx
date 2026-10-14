import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Sheet, KeyRound, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { connectSheet, createSheet, saveSettings } from "@/lib/workspace/workspace.functions";
import { useWorkspace } from "@/lib/workspace/use-workspace";

export const Route = createFileRoute("/_authenticated/workspace/settings")({
  head: () => ({
    meta: [
      { title: "Workspace settings — App Forge" },
      { name: "description", content: "Connect your Google Sheet and GitHub token." },
      { property: "og:title", content: "Workspace settings — App Forge" },
      { property: "og:description", content: "Connect your Google Sheet and GitHub token." },
    ],
  }),
  component: SettingsPage,
});

const err = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong");

function SettingsPage() {
  const qc = useQueryClient();
  const ws = useWorkspace();
  const connectFn = useServerFn(connectSheet);
  const createFn = useServerFn(createSheet);
  const saveFn = useServerFn(saveSettings);

  const [sheetInput, setSheetInput] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    const s = ws.data?.settings;
    if (s) {
      setRepoUrl(s.repoUrl);
      setAuthorName(s.authorName);
      setAuthorEmail(s.authorEmail);
    }
    if (ws.data?.sheetId) setSheetInput(ws.data.sheetId);
  }, [ws.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["workspace"] });

  const connectMut = useMutation({
    mutationFn: () => {
      const m = sheetInput.match(/\/d\/([A-Za-z0-9_-]+)/);
      return connectFn({ data: { sheetId: m?.[1] ?? sheetInput.trim() } });
    },
    onSuccess: () => {
      toast.success("Google Sheet connected");
      refresh();
    },
    onError: err,
  });
  const createMut = useMutation({
    mutationFn: () => createFn(),
    onSuccess: () => {
      toast.success("New Google Sheet created");
      refresh();
    },
    onError: err,
  });
  const saveMut = useMutation({
    mutationFn: (clearToken?: boolean) =>
      saveFn({ data: { repoUrl, authorName, authorEmail, token: token || undefined, clearToken } }),
    onSuccess: () => {
      setToken("");
      toast.success("Settings saved to your sheet");
      refresh();
    },
    onError: err,
  });

  const sheetId = ws.data?.sheetId;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2 font-semibold">
          <Sheet className="h-4 w-4" /> Google Sheet
        </div>
        <p className="text-sm text-muted-foreground">
          Your chat history and settings are saved in the <b>ChatHistory</b> and <b>AppSettings</b> tabs.
          The sheet must belong to the connected Google account.
        </p>
        {ws.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            {sheetId && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${sheetId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary underline"
              >
                Open connected sheet <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {ws.data?.error && <p className="text-sm text-destructive">{ws.data.error}</p>}
            <Label htmlFor="sheet">Sheet link or ID</Label>
            <Input
              id="sheet"
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => connectMut.mutate()} disabled={!sheetInput.trim() || connectMut.isPending}>
                {connectMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Connect sheet
              </Button>
              <Button variant="outline" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
                {createMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Create a new sheet
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="space-y-3 rounded-xl border p-4">
        <div className="flex items-center gap-2 font-semibold">
          <KeyRound className="h-4 w-4" /> GitHub
        </div>
        {!sheetId && <p className="text-sm text-muted-foreground">Connect a sheet first — settings are stored there.</p>}
        <Label htmlFor="repo">Repository URL</Label>
        <Input id="repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/you/repo.git" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="an">Commit author name</Label>
            <Input id="an" value={authorName} onChange={(e) => setAuthorName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ae">Commit author email</Label>
            <Input id="ae" value={authorEmail} onChange={(e) => setAuthorEmail(e.target.value)} />
          </div>
        </div>
        <Label htmlFor="tok">Personal access token</Label>
        <Input
          id="tok"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={ws.data?.settings?.hasToken ? "Saved (encrypted) — enter a new one to replace" : "ghp_… or github_pat_…"}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          The token is encrypted before it's written to the AppSettings tab. Give it only the "Contents: read & write" permission.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => saveMut.mutate(false)} disabled={!sheetId || saveMut.isPending}>
            {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save settings
          </Button>
          {ws.data?.settings?.hasToken && (
            <Button variant="ghost" onClick={() => saveMut.mutate(true)} disabled={saveMut.isPending}>
              Remove saved token
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
