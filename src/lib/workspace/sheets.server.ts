// Server-only Google Sheets helpers (through the Lovable connector gateway).
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

export const CHAT_SHEET = "ChatHistory";
export const SETTINGS_SHEET = "AppSettings";
const CHAT_HEADERS = ["user_id", "timestamp", "sender", "message", "attachments"];
const SETTINGS_HEADERS = ["user_id", "key", "value", "updated_at"];

function keys() {
  const lovable = process.env.LOVABLE_API_KEY;
  const sheets = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovable) throw new Error("AI/connector key is not configured");
  if (!sheets) throw new Error("Google Sheets is not connected");
  return { lovable, sheets };
}

async function call<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const k = keys();
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${k.lovable}`,
      "X-Connection-Api-Key": k.sheets,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets request failed [${res.status}]: ${body}`);
    let msg = body;
    try {
      msg = JSON.parse(body)?.error?.message ?? body;
    } catch {
      /* keep raw */
    }
    throw new Error(`Google Sheets error (${res.status}): ${msg.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function createSpreadsheet(title: string): Promise<string> {
  const data = await call<{ spreadsheetId: string }>("/spreadsheets", {
    method: "POST",
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: CHAT_SHEET } }, { properties: { title: SETTINGS_SHEET } }],
    }),
  });
  await call(`/spreadsheets/${data.spreadsheetId}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: [
        { range: `${CHAT_SHEET}!A1:E1`, values: [CHAT_HEADERS] },
        { range: `${SETTINGS_SHEET}!A1:D1`, values: [SETTINGS_HEADERS] },
      ],
    }),
  });
  return data.spreadsheetId;
}

/** Make sure both tabs exist with header rows. */
export async function ensureTabs(sheetId: string) {
  const meta = await call<{ sheets: { properties: { title: string } }[] }>(
    `/spreadsheets/${sheetId}?fields=sheets.properties.title`,
  );
  const titles = new Set(meta.sheets.map((s) => s.properties.title));
  const add = [CHAT_SHEET, SETTINGS_SHEET].filter((t) => !titles.has(t));
  if (add.length) {
    await call(`/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: add.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    const data = [];
    if (add.includes(CHAT_SHEET)) data.push({ range: `${CHAT_SHEET}!A1:E1`, values: [CHAT_HEADERS] });
    if (add.includes(SETTINGS_SHEET))
      data.push({ range: `${SETTINGS_SHEET}!A1:D1`, values: [SETTINGS_HEADERS] });
    await call(`/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
  }
}

export async function readRows(sheetId: string, tab: string, cols: string): Promise<string[][]> {
  const data = await call<{ values?: string[][] }>(
    `/spreadsheets/${sheetId}/values/${tab}!A2:${cols}`,
  );
  return data.values ?? [];
}

export async function appendRow(sheetId: string, tab: string, row: string[]) {
  await call(
    `/spreadsheets/${sheetId}/values/${tab}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
}

export async function updateRow(sheetId: string, tab: string, rowNumber: number, row: string[]) {
  const end = String.fromCharCode(64 + row.length);
  await call(`/spreadsheets/${sheetId}/values/${tab}!A${rowNumber}:${end}${rowNumber}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [row] }),
  });
}

/** Upsert a per-user key in AppSettings. */
export async function setSetting(sheetId: string, userId: string, key: string, value: string) {
  const rows = await readRows(sheetId, SETTINGS_SHEET, "D");
  const idx = rows.findIndex((r) => r[0] === userId && r[1] === key);
  const row = [userId, key, value, new Date().toISOString()];
  if (idx >= 0) await updateRow(sheetId, SETTINGS_SHEET, idx + 2, row);
  else await appendRow(sheetId, SETTINGS_SHEET, row);
}

export async function getSettings(sheetId: string, userId: string): Promise<Record<string, string>> {
  const rows = await readRows(sheetId, SETTINGS_SHEET, "D");
  const out: Record<string, string> = {};
  for (const r of rows) if (r[0] === userId && r[1]) out[r[1]] = r[2] ?? "";
  return out;
}
