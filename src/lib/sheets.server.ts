// Server-only Google Sheets helpers (via the Lovable connector gateway).
const GATEWAY = "https://connector-gateway.lovable.dev/google_sheets/v4";

export const CHAT_SHEET = "ChatHistory";
export const SETTINGS_SHEET = "AppSettings";
const CHAT_HEADER = ["Timestamp", "User", "Sender", "Message", "Attachments"];
const SETTINGS_HEADER = ["User", "Key", "Value", "Updated"];
const MAX_CELL = 45000;

function headers() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const conn = process.env["GOOGLE_SHEETS_API_KEY"];
  if (!lovable || !conn) throw new Error("Google Sheets is not connected.");
  return {
    Authorization: `Bearer ${lovable}`,
    "X-Connection-Api-Key": conn,
    "Content-Type": "application/json",
  };
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, { ...init, headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Sheets request failed [${res.status}]: ${body}`);
    if (res.status === 404) throw new Error("Google Sheet not found. Check the Sheet ID in Settings.");
    if (res.status === 403) throw new Error("No access to this Google Sheet with the connected Google account.");
    if (res.status === 429) throw new Error("Google Sheets is busy. Try again in a minute.");
    throw new Error(`Google Sheets error ${res.status}`);
  }
  return res.json();
}

export function cleanSheetId(input: string) {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : input).trim();
}

export async function ensureSheets(sheetId: string) {
  const meta = (await call(`/spreadsheets/${sheetId}?fields=sheets.properties.title`)) as {
    sheets?: { properties: { title: string } }[];
  };
  const titles = new Set((meta.sheets ?? []).map((s) => s.properties.title));
  const missing = [CHAT_SHEET, SETTINGS_SHEET].filter((t) => !titles.has(t));
  if (missing.length) {
    await call(`/spreadsheets/${sheetId}:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    });
    const data = [];
    if (missing.includes(CHAT_SHEET)) data.push({ range: `${CHAT_SHEET}!A1:E1`, values: [CHAT_HEADER] });
    if (missing.includes(SETTINGS_SHEET)) data.push({ range: `${SETTINGS_SHEET}!A1:D1`, values: [SETTINGS_HEADER] });
    await call(`/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
  }
}

export async function appendChatRow(
  sheetId: string,
  row: { user: string; sender: string; message: string; attachments: string },
) {
  const values = [[new Date().toISOString(), row.user, row.sender, row.message.slice(0, MAX_CELL), row.attachments.slice(0, MAX_CELL)]];
  await call(`/spreadsheets/${sheetId}/values/${CHAT_SHEET}!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    body: JSON.stringify({ values }),
  });
}

export async function readChatRows(sheetId: string, user: string) {
  const data = (await call(`/spreadsheets/${sheetId}/values/${CHAT_SHEET}!A2:E`)) as { values?: string[][] };
  return (data.values ?? [])
    .filter((r) => r[1] === user)
    .slice(-100)
    .map((r) => ({ timestamp: r[0] ?? "", sender: r[2] ?? "", message: r[3] ?? "", attachments: r[4] ?? "" }));
}

export async function writeSettingsRows(sheetId: string, user: string, entries: Record<string, string>) {
  const data = (await call(`/spreadsheets/${sheetId}/values/${SETTINGS_SHEET}!A2:D`)) as { values?: string[][] };
  const rows = data.values ?? [];
  const now = new Date().toISOString();
  const updates: { range: string; values: string[][] }[] = [];
  const appends: string[][] = [];
  for (const [key, value] of Object.entries(entries)) {
    const idx = rows.findIndex((r) => r[0] === user && r[1] === key);
    if (idx >= 0) updates.push({ range: `${SETTINGS_SHEET}!A${idx + 2}:D${idx + 2}`, values: [[user, key, value, now]] });
    else appends.push([user, key, value, now]);
  }
  if (updates.length) {
    await call(`/spreadsheets/${sheetId}/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
    });
  }
  if (appends.length) {
    await call(`/spreadsheets/${sheetId}/values/${SETTINGS_SHEET}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: "POST",
      body: JSON.stringify({ values: appends }),
    });
  }
}
