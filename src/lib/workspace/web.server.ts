// Fetch a public web page and reduce it to readable text. Blocks private/internal hosts.
const MAX_BYTES = 2_000_000;
const MAX_TEXT = 20_000;

function isBlockedHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return h.includes(":");
  return false;
}

export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid link");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https links are supported");
  if (isBlockedHost(u.hostname)) throw new Error("Private or internal addresses can't be fetched");
  return u;
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim());
  let body = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|iframe|template|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  const text = decodeEntities(body)
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
  return { title, text };
}

export async function fetchPage(raw: string) {
  let url = assertPublicUrl(raw);
  let res: Response | null = null;
  for (let i = 0; i < 4; i++) {
    res = await fetch(url.toString(), {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WorkspaceReader/1.0)", Accept: "text/html,*/*" },
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`The site responded with ${res?.status ?? "no answer"}`);
  const type = res.headers.get("content-type") ?? "";
  const buf = await res.arrayBuffer();
  const raw2 = new TextDecoder().decode(buf.slice(0, MAX_BYTES));
  if (type.includes("text/html") || raw2.trimStart().startsWith("<")) {
    const { title, text } = htmlToText(raw2);
    return { url: url.toString(), title: title || url.hostname, text };
  }
  if (type.startsWith("text/") || type.includes("json")) {
    return { url: url.toString(), title: url.hostname, text: raw2.slice(0, MAX_TEXT) };
  }
  throw new Error(`This link isn't a readable page (${type || "unknown type"})`);
}
