// Server-only: fetch a public web page and extract readable text.
const MAX_BYTES = 2_000_000;
const MAX_TEXT = 20_000;

function isBlockedHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
  }
  if (h.includes(":")) return true; // block raw IPv6 literals
  return false;
}

export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid link.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https links are supported.");
  if (isBlockedHost(url.hostname)) throw new Error("That address isn't a public website.");
  return url;
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html: string) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const main = body.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i)?.[2];
  if (main && main.length > 500) body = main;
  const text = body
    .replace(/<(script|style|noscript|svg|iframe|template|nav|footer|header|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const clean = decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title: decodeEntities(titleMatch?.[1]?.trim() ?? ""), text: clean.slice(0, MAX_TEXT) };
}

export async function readWebPage(raw: string) {
  let url = assertPublicUrl(raw);
  let res: Response | null = null;
  for (let i = 0; i < 4; i++) {
    res = await fetch(url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WorkbenchReader/1.0)", Accept: "text/html,text/plain" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = assertPublicUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`The page answered with an error (${res?.status ?? "no response"}).`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|xml/.test(type)) throw new Error("That link isn't a web page (it may be a file or image).");
  const buf = await res.arrayBuffer();
  const raw2 = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
  const { title, text } = type.includes("text/plain") ? { title: "", text: raw2.slice(0, MAX_TEXT) } : htmlToText(raw2);
  if (!text) throw new Error("Couldn't find readable text on that page.");
  return { url: url.toString(), title, text };
}
