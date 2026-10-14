// Browser-side file + .zip processing for chat attachments.
const TEXT_EXT = new Set([
  "txt","md","markdown","json","js","jsx","ts","tsx","mjs","cjs","css","scss","html","htm","xml","yml","yaml","toml",
  "ini","env","py","rb","go","rs","java","kt","swift","c","h","cpp","hpp","cs","php","sh","bash","sql","csv","vue",
  "svelte","gradle","properties","dockerfile","gitignore","lock","log","conf","cfg",
]);
const SNIPPET_CHARS = 4000;
const TOTAL_CHARS = 60000;
const MAX_FILES_READ = 40;

export type AttachmentMeta = { name: string; size: number; type: string; files?: number };
export type ProcessedAttachment = { meta: AttachmentMeta; context: string };

function isTextName(name: string) {
  const base = name.split("/").pop()?.toLowerCase() ?? "";
  if (["dockerfile", "makefile", "readme", "license"].includes(base)) return true;
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return TEXT_EXT.has(ext);
}

function tree(paths: string[]) {
  return paths.slice(0, 300).map((p) => {
    const depth = p.split("/").length - 1;
    return `${"  ".repeat(depth)}${p.split("/").pop()}`;
  }).join("\n") + (paths.length > 300 ? `\n… ${paths.length - 300} more` : "");
}

async function processZip(file: File): Promise<ProcessedAttachment> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((f) => !f.dir && !f.name.includes("__MACOSX/") && !f.name.includes("/.git/"));
  const paths = entries.map((e) => e.name).sort();
  let budget = TOTAL_CHARS;
  const parts: string[] = [];
  let read = 0;
  for (const e of entries.filter((e) => isTextName(e.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    if (read >= MAX_FILES_READ || budget <= 0) break;
    const text = await e.async("string");
    if (text.includes("\u0000")) continue;
    const snip = text.slice(0, Math.min(SNIPPET_CHARS, budget));
    budget -= snip.length;
    read++;
    parts.push(`--- ${e.name} ---\n${snip}${text.length > snip.length ? "\n…(truncated)" : ""}`);
  }
  return {
    meta: { name: file.name, size: file.size, type: "application/zip", files: paths.length },
    context: `<attachment name="${file.name}" kind="zip" files="${paths.length}">\nFile tree:\n${tree(paths)}\n\nFile contents (${read} text files):\n${parts.join("\n\n")}\n</attachment>`,
  };
}

export async function processFile(file: File): Promise<ProcessedAttachment> {
  if (file.name.toLowerCase().endsWith(".zip") || file.type.includes("zip")) return processZip(file);
  const meta: AttachmentMeta = { name: file.name, size: file.size, type: file.type || "unknown" };
  if (isTextName(file.name) || file.type.startsWith("text/") || file.type.includes("json")) {
    const text = (await file.text()).slice(0, 20000);
    return { meta, context: `<attachment name="${file.name}">\n${text}\n</attachment>` };
  }
  return {
    meta,
    context: `<attachment name="${file.name}" type="${meta.type}" size="${file.size}">(binary file — contents not readable as text)</attachment>`,
  };
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function extractUrls(text: string) {
  return Array.from(new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])).slice(0, 3);
}
