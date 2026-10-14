// Browser-only Git helpers (isomorphic-git + IndexedDB filesystem). Import only from effects/handlers.
export const REPO_DIR = "/repo";
type Log = (line: string) => void;

let cached: Promise<{ git: any; http: any; fs: any; pfs: any }> | null = null;

export function loadGit() {
  if (!cached) {
    cached = (async () => {
      const { Buffer } = await import("buffer");
      (globalThis as any).Buffer ??= Buffer;
      const [git, http, LFS] = await Promise.all([
        import("isomorphic-git"),
        import("isomorphic-git/http/web"),
        import("@isomorphic-git/lightning-fs"),
      ]);
      const fs = new (LFS.default as any)("workspace-git");
      return { git: (git as any).default ?? git, http: (http as any).default ?? http, fs, pfs: fs.promises };
    })();
  }
  return cached;
}

export type GitAuth = { token: string; appToken: string; name: string; email: string };

function opts(auth: GitAuth, log: Log) {
  return {
    corsProxy: `${window.location.origin}/api/git-proxy`,
    headers: { "x-app-auth": auth.appToken },
    onAuth: () => (auth.token ? { username: "x-access-token", password: auth.token } : undefined),
    onAuthFailure: () => {
      log("✖ Authentication failed — check your GitHub token in Settings.");
      return { cancel: true };
    },
    onProgress: (p: { phase: string; loaded: number; total?: number }) =>
      log(`${p.phase}: ${p.loaded}${p.total ? `/${p.total}` : ""}`),
    onMessage: (m: string) => log(`remote: ${m.trim()}`),
  };
}

async function rmrf(pfs: any, path: string) {
  let st;
  try {
    st = await pfs.stat(path);
  } catch {
    return;
  }
  if (st.isDirectory()) {
    for (const f of await pfs.readdir(path)) await rmrf(pfs, `${path}/${f}`);
    await pfs.rmdir(path);
  } else await pfs.unlink(path);
}

export async function hasRepo() {
  const { pfs } = await loadGit();
  try {
    await pfs.stat(`${REPO_DIR}/.git`);
    return true;
  } catch {
    return false;
  }
}

export async function cloneRepo(url: string, auth: GitAuth, log: Log) {
  const { git, http, fs, pfs } = await loadGit();
  log(`Removing old local copy…`);
  await rmrf(pfs, REPO_DIR);
  await pfs.mkdir(REPO_DIR).catch(() => {});
  log(`Cloning ${url}…`);
  await git.clone({ fs, http, dir: REPO_DIR, url, singleBranch: true, depth: 50, ...opts(auth, log) });
  log("✔ Clone complete");
}

export async function pullRepo(auth: GitAuth, log: Log) {
  const { git, http, fs } = await loadGit();
  const ref = await git.currentBranch({ fs, dir: REPO_DIR });
  log(`Pulling ${ref ?? "current branch"}…`);
  await git.pull({
    fs, http, dir: REPO_DIR, ref, singleBranch: true, fastForward: true,
    author: { name: auth.name || "Workspace User", email: auth.email || "user@example.com" },
    ...opts(auth, log),
  });
  log("✔ Pull complete");
}

export async function commitAndPush(message: string, auth: GitAuth, log: Log) {
  const { git, http, fs } = await loadGit();
  const matrix: [string, number, number, number][] = await git.statusMatrix({ fs, dir: REPO_DIR });
  let changed = 0;
  for (const [file, head, work, stage] of matrix) {
    if (head === 1 && work === 1 && stage === 1) continue;
    changed++;
    if (work === 0) {
      await git.remove({ fs, dir: REPO_DIR, filepath: file });
      log(`staged delete: ${file}`);
    } else {
      await git.add({ fs, dir: REPO_DIR, filepath: file });
      log(`staged: ${file}`);
    }
  }
  if (!changed) {
    log("Nothing to commit — working tree clean.");
  } else {
    const sha = await git.commit({
      fs, dir: REPO_DIR, message,
      author: { name: auth.name || "Workspace User", email: auth.email || "user@example.com" },
    });
    log(`✔ Committed ${sha.slice(0, 7)}`);
  }
  const ref = await git.currentBranch({ fs, dir: REPO_DIR });
  log(`Pushing ${ref}…`);
  const res = await git.push({ fs, http, dir: REPO_DIR, ref, ...opts(auth, log) });
  if (res?.ok === false || res?.error) throw new Error(res.error ?? "Push rejected");
  log("✔ Push complete");
}

export type RepoStatus = {
  branch: string | null;
  remote: string | null;
  changes: { file: string; state: string }[];
  log: { oid: string; message: string; author: string; date: string }[];
  files: string[];
};

export async function repoStatus(): Promise<RepoStatus> {
  const { git, fs } = await loadGit();
  const branch = await git.currentBranch({ fs, dir: REPO_DIR });
  const remote = (await git.getConfig({ fs, dir: REPO_DIR, path: "remote.origin.url" })) ?? null;
  const matrix: [string, number, number, number][] = await git.statusMatrix({ fs, dir: REPO_DIR });
  const changes = matrix
    .filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1))
    .map(([file, h, w]) => ({ file, state: h === 0 ? "new" : w === 0 ? "deleted" : "modified" }));
  const commits = await git.log({ fs, dir: REPO_DIR, depth: 20 }).catch(() => []);
  return {
    branch,
    remote,
    changes,
    files: matrix.map(([f]) => f).filter((f) => !f.startsWith(".git/")),
    log: commits.map((c: any) => ({
      oid: c.oid,
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toLocaleString(),
    })),
  };
}

export async function readRepoFile(path: string) {
  const { pfs } = await loadGit();
  return (await pfs.readFile(`${REPO_DIR}/${path}`, { encoding: "utf8" })) as string;
}

export async function writeRepoFile(path: string, content: string) {
  const { pfs } = await loadGit();
  const parts = path.split("/").slice(0, -1);
  let cur = REPO_DIR;
  for (const p of parts) {
    cur += `/${p}`;
    await pfs.mkdir(cur).catch(() => {});
  }
  await pfs.writeFile(`${REPO_DIR}/${path}`, content, "utf8");
}

export async function deleteRepoFile(path: string) {
  const { pfs } = await loadGit();
  await pfs.unlink(`${REPO_DIR}/${path}`);
}
