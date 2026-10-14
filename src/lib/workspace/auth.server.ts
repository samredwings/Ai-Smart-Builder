import { createClient } from "@supabase/supabase-js";

/** Verify a Supabase access token from a raw HTTP request. Returns the user id or null. */
export async function verifyBearer(token: string | null | undefined): Promise<string | null> {
  if (!token || token.split(".").length !== 3) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
  const { data, error } = await sb.auth.getClaims(token);
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub as string;
}

export function bearerFrom(request: Request, header = "authorization") {
  const v = request.headers.get(header);
  return v?.startsWith("Bearer ") ? v.slice(7) : v;
}
