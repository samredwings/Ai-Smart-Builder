import { createFileRoute } from "@tanstack/react-router";
import { verifyBearer } from "@/lib/workspace/auth.server";

// CORS proxy for in-browser Git (isomorphic-git). Only forwards to known Git hosts,
// and only for signed-in users (token sent in x-app-auth).
const ALLOWED_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org"]);
const FORWARD_HEADERS = ["authorization", "content-type", "accept", "git-protocol", "user-agent"];

async function handle({ request, params }: { request: Request; params: { _splat?: string } }) {
  const userId = await verifyBearer(request.headers.get("x-app-auth"));
  if (!userId) return new Response("Sign in required", { status: 401 });

  const splat = params._splat ?? "";
  const host = splat.split("/")[0]?.toLowerCase() ?? "";
  if (!ALLOWED_HOSTS.has(host)) return new Response("Host not allowed", { status: 403 });

  const incoming = new URL(request.url);
  const target = `https://${splat}${incoming.search}`;
  const headers = new Headers();
  for (const h of FORWARD_HEADERS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has("user-agent")) headers.set("user-agent", "git/isomorphic-git");

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "follow",
  });
  const out = new Headers();
  for (const h of ["content-type", "cache-control", "www-authenticate"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export const Route = createFileRoute("/api/git-proxy/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
