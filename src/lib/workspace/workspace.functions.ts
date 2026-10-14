import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CHAT_SHEET,
  appendRow,
  createSpreadsheet,
  ensureTabs,
  getSettings,
  readRows,
  setSetting,
} from "./sheets.server";
import { decryptText, encryptText } from "./crypto.server";
import { fetchPage } from "./web.server";

type Ctx = { supabase: any; userId: string };

async function sheetIdFor(ctx: Ctx): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("user_workspace")
    .select("sheet_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.sheet_id ?? null;
}

async function requireSheet(ctx: Ctx) {
  const id = await sheetIdFor(ctx);
  if (!id) throw new Error("Connect a Google Sheet in Settings first");
  return id;
}

async function saveSheetIdRow(ctx: Ctx, sheetId: string) {
  const { error } = await ctx.supabase
    .from("user_workspace")
    .upsert({ user_id: ctx.userId, sheet_id: sheetId });
  if (error) throw new Error(error.message);
}

export type ChatLogRow = { timestamp: string; sender: string; message: string; attachments: string };

export const getWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sheetId = await sheetIdFor(context);
    if (!sheetId) return { sheetId: null, settings: null, history: [] as ChatLogRow[], error: null };
    try {
      const s = await getSettings(sheetId, context.userId);
      const rows = await readRows(sheetId, CHAT_SHEET, "E");
      const history = rows
        .filter((r) => r[0] === context.userId)
        .slice(-100)
        .map((r) => ({ timestamp: r[1] ?? "", sender: r[2] ?? "", message: r[3] ?? "", attachments: r[4] ?? "" }));
      return {
        sheetId,
        settings: {
          repoUrl: s.git_repo_url ?? "",
          authorName: s.git_author_name ?? "",
          authorEmail: s.git_author_email ?? "",
          hasToken: Boolean(s.github_token_enc),
        },
        history,
        error: null,
      };
    } catch (e) {
      return { sheetId, settings: null, history: [] as ChatLogRow[], error: e instanceof Error ? e.message : "Sheet error" };
    }
  });

export const connectSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ sheetId: z.string().trim().min(10).max(200).regex(/^[A-Za-z0-9_-]+$/, "Invalid Sheet ID") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await ensureTabs(data.sheetId);
    await saveSheetIdRow(context, data.sheetId);
    return { sheetId: data.sheetId };
  });

export const createSheet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const id = await createSpreadsheet("App Forge Workspace");
    await saveSheetIdRow(context, id);
    return { sheetId: id };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        repoUrl: z.string().trim().max(500),
        authorName: z.string().trim().max(100),
        authorEmail: z.string().trim().max(200),
        token: z.string().trim().max(500).optional(),
        clearToken: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sheetId = await requireSheet(context);
    const u = context.userId;
    await setSetting(sheetId, u, "git_repo_url", data.repoUrl);
    await setSetting(sheetId, u, "git_author_name", data.authorName);
    await setSetting(sheetId, u, "git_author_email", data.authorEmail);
    if (data.clearToken) await setSetting(sheetId, u, "github_token_enc", "");
    else if (data.token) await setSetting(sheetId, u, "github_token_enc", await encryptText(data.token));
    return { ok: true };
  });

/** Returns the decrypted GitHub token to its owner so the browser can run Git. */
export const getGitCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sheetId = await requireSheet(context);
    const s = await getSettings(sheetId, context.userId);
    return {
      token: s.github_token_enc ? await decryptText(s.github_token_enc) : "",
      repoUrl: s.git_repo_url ?? "",
      authorName: s.git_author_name ?? "",
      authorEmail: s.git_author_email ?? "",
    };
  });

export const saveRepoUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ repoUrl: z.string().trim().url().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const sheetId = await requireSheet(context);
    await setSetting(sheetId, context.userId, "git_repo_url", data.repoUrl);
    return { ok: true };
  });

export const logChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sender: z.enum(["user", "assistant"]),
        message: z.string().max(45000),
        attachments: z.string().max(5000).default(""),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sheetId = await sheetIdFor(context);
    if (!sheetId) return { logged: false };
    await appendRow(sheetId, CHAT_SHEET, [
      context.userId,
      new Date().toISOString(),
      data.sender,
      data.message,
      data.attachments,
    ]);
    return { logged: true };
  });

export const fetchWebPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ url: z.string().trim().max(2000) }).parse(d))
  .handler(async ({ data }) => fetchPage(data.url));
