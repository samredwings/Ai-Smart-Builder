import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function getSheetId(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase.from("workspace_settings").select("sheet_id").eq("user_id", userId).maybeSingle();
  return data?.sheet_id ?? null;
}

function userLabel(claims: any, userId: string) {
  return (claims?.email as string | undefined) ?? userId;
}

export const getSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("workspace_settings")
      .select("sheet_id, git_repo_url")
      .eq("user_id", context.userId)
      .maybeSingle();
    return { sheetId: data?.sheet_id ?? "", gitRepoUrl: data?.git_repo_url ?? "" };
  });

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ sheetId: z.string().max(300), gitRepoUrl: z.string().max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { cleanSheetId, ensureSheets, writeSettingsRows } = await import("./sheets.server");
    const sheetId = data.sheetId ? cleanSheetId(data.sheetId) : "";
    if (data.gitRepoUrl && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(data.gitRepoUrl)) {
      throw new Error("Repository must be a https://github.com/owner/repo link.");
    }
    if (sheetId) await ensureSheets(sheetId);
    const { error } = await context.supabase
      .from("workspace_settings")
      .upsert({ user_id: context.userId, sheet_id: sheetId || null, git_repo_url: data.gitRepoUrl || null });
    if (error) throw new Error(error.message);
    if (sheetId) {
      await writeSettingsRows(sheetId, userLabel(context.claims, context.userId), {
        sheet_id: sheetId,
        git_repo_url: data.gitRepoUrl,
      });
    }
    return { sheetId, synced: Boolean(sheetId) };
  });

export const loadChatHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sheetId = await getSheetId(context.supabase, context.userId);
    if (!sheetId) return { connected: false, rows: [] as { timestamp: string; sender: string; message: string; attachments: string }[] };
    const { readChatRows } = await import("./sheets.server");
    const rows = await readChatRows(sheetId, userLabel(context.claims, context.userId));
    return { connected: true, rows };
  });

export const logChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        sender: z.enum(["user", "assistant"]),
        message: z.string().max(200000),
        attachments: z.string().max(100000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const sheetId = await getSheetId(context.supabase, context.userId);
    if (!sheetId) return { logged: false };
    const { appendChatRow } = await import("./sheets.server");
    await appendChatRow(sheetId, { user: userLabel(context.claims, context.userId), ...data });
    return { logged: true };
  });

export const fetchWebPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ url: z.string().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { readWebPage } = await import("./web-reader.server");
    return readWebPage(data.url);
  });
