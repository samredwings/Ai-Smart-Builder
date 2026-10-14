import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Paperclip, Send, Square, Loader2, FileArchive, File as FileIcon, Link2, X, Bot } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fetchWebPage, logChatMessage } from "@/lib/workspace/workspace.functions";
import { useWorkspace } from "@/lib/workspace/use-workspace";
import { extractUrls, formatBytes, processFile, type AttachmentMeta, type ProcessedAttachment } from "@/lib/workspace/zip";

export const Route = createFileRoute("/_authenticated/workspace/chat")({
  head: () => ({
    meta: [
      { title: "Chat — App Forge Workspace" },
      { name: "description", content: "Chat with AI about your files, ZIP archives and web links." },
      { property: "og:title", content: "Chat — App Forge Workspace" },
      { property: "og:description", content: "Chat with AI about your files, ZIP archives and web links." },
    ],
  }),
  component: ChatPage,
});

type Meta = { attachments?: AttachmentMeta[]; links?: string[] };

function textOf(m: UIMessage, userOnlyFirst: boolean) {
  const texts = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
  return userOnlyFirst ? texts[0] ?? "" : texts.join("");
}

function ChatPage() {
  const ws = useWorkspace();
  const logFn = useServerFn(logChatMessage);
  const fetchFn = useServerFn(fetchWebPage);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<ProcessedAttachment[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedHistory = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/workspace-chat",
        headers: async (): Promise<Record<string, string>> => {
          const { data } = await supabase.auth.getSession();
          return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
        },
      }),
    [],
  );

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    transport,
    onFinish: ({ message }) => {
      const text = textOf(message, false);
      if (text) logFn({ data: { sender: "assistant", message: text.slice(0, 45000), attachments: "" } }).catch(() => {});
      textRef.current?.focus();
    },
    onError: (e) => toast.error(e.message || "The AI couldn't answer"),
  });

  // Restore past conversation from the ChatHistory sheet once.
  useEffect(() => {
    if (loadedHistory.current || !ws.data) return;
    loadedHistory.current = true;
    const hist = ws.data.history ?? [];
    if (hist.length && messages.length === 0) {
      setMessages(
        hist.map((h, i) => {
          let attachments: AttachmentMeta[] | undefined;
          try {
            attachments = h.attachments ? JSON.parse(h.attachments) : undefined;
          } catch {
            attachments = undefined;
          }
          return {
            id: `hist-${i}`,
            role: h.sender === "assistant" ? "assistant" : "user",
            parts: [{ type: "text", text: h.message }],
            metadata: { attachments },
          } as UIMessage;
        }),
      );
    }
  }, [ws.data, messages.length, setMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, status]);
  useEffect(() => textRef.current?.focus(), []);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setBusy("Reading files…");
    try {
      const out: ProcessedAttachment[] = [];
      for (const f of Array.from(list)) {
        if (f.size > 50 * 1024 * 1024) {
          toast.error(`${f.name} is larger than 50 MB`);
          continue;
        }
        out.push(await processFile(f));
      }
      setPending((p) => [...p, ...out]);
      if (out.length) toast.success(`${out.length} file${out.length > 1 ? "s" : ""} ready`);
    } catch (e) {
      toast.error(e instanceof Error ? `Couldn't read file: ${e.message}` : "Couldn't read file");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pending.length) || status === "streaming" || status === "submitted" || busy) return;
    const urls = extractUrls(text);
    const contexts = pending.map((p) => p.context);
    const okLinks: string[] = [];
    if (urls.length) {
      setBusy(`Reading ${urls.length} link${urls.length > 1 ? "s" : ""}…`);
      for (const u of urls) {
        try {
          const page = await fetchFn({ data: { url: u } });
          contexts.push(`<webpage url="${page.url}" title="${page.title}">\n${page.text}\n</webpage>`);
          okLinks.push(u);
        } catch (e) {
          toast.error(`Couldn't read ${u}: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      setBusy(null);
    }
    const attachments = pending.map((p) => p.meta);
    const parts: { type: "text"; text: string }[] = [{ type: "text", text: text || "Please review the attached files." }];
    if (contexts.length) parts.push({ type: "text", text: `\n\n${contexts.join("\n\n")}` });
    setInput("");
    setPending([]);
    sendMessage({ role: "user", parts, metadata: { attachments, links: okLinks } satisfies Meta });
    logFn({
      data: {
        sender: "user",
        message: text,
        attachments: attachments.length || okLinks.length ? JSON.stringify([...attachments, ...okLinks.map((l) => ({ name: l, type: "link", size: 0 }))]).slice(0, 5000) : "",
      },
    }).catch((e) => toast.error(`Not saved to sheet: ${e instanceof Error ? e.message : "error"}`));
  }

  const working = status === "submitted" || status === "streaming";

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col md:h-[calc(100dvh-7rem)]">
      {!ws.isLoading && !ws.data?.sheetId && (
        <div className="mb-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Chats aren't being saved yet. <Link to="/workspace/settings" className="text-primary underline">Connect a Google Sheet</Link>.
        </div>
      )}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto rounded-xl border p-3">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <Bot className="h-8 w-8" />
            <p>Ask anything, attach files or a .zip, or paste a link to summarize.</p>
          </div>
        )}
        {messages.map((m) => {
          const meta = (m.metadata ?? {}) as Meta;
          const isUser = m.role === "user";
          return (
            <div key={m.id} className={isUser ? "flex flex-col items-end" : ""}>
              {isUser ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {textOf(m, true)}
                </div>
              ) : (
                <div className="prose prose-sm max-w-none text-sm dark:prose-invert [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-2">
                  <ReactMarkdown>{textOf(m, false)}</ReactMarkdown>
                </div>
              )}
              {(meta.attachments?.length || meta.links?.length) ? (
                <div className="mt-1 flex flex-wrap justify-end gap-1">
                  {meta.attachments?.map((a, i) => <Chip key={i} meta={a} />)}
                  {meta.links?.map((l) => (
                    <span key={l} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                      <Link2 className="h-3 w-3" /> {new URL(l).hostname}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {status === "submitted" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error.message}</p>}
      </div>

      <div className="mt-3 space-y-2">
        {(pending.length > 0 || busy) && (
          <div className="flex flex-wrap items-center gap-1">
            {pending.map((p, i) => (
              <Chip key={i} meta={p.meta} onRemove={() => setPending((x) => x.filter((_, j) => j !== i))} />
            ))}
            {busy && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {busy}
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          <Button variant="outline" size="icon" onClick={() => fileRef.current?.click()} aria-label="Attach files" disabled={!!busy}>
            <Paperclip className="h-4 w-4" />
          </Button>
          <Textarea
            ref={textRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message, or paste a link…"
            className="min-h-[44px] flex-1 resize-none text-sm"
          />
          {working ? (
            <Button size="icon" variant="secondary" onClick={() => stop()} aria-label="Stop">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={send} disabled={(!input.trim() && !pending.length) || !!busy} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ meta, onRemove }: { meta: AttachmentMeta; onRemove?: () => void }) {
  const Icon = meta.type.includes("zip") ? FileArchive : FileIcon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-[11px]">
      <Icon className="h-3 w-3" />
      <span className="max-w-[140px] truncate">{meta.name}</span>
      <span className="text-muted-foreground">
        {formatBytes(meta.size)}
        {meta.files ? ` · ${meta.files} files` : ""}
      </span>
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${meta.name}`}>
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
