/**
 * Notebook login + save service (Cloudflare Worker, no dependencies).
 *
 * - Login: GitHub OAuth is used only to prove *who* you are. Only ALLOWED_LOGIN
 *   gets a session. The session is an HMAC-signed token returned to the page.
 * - Save: the Worker writes to the private notes repo with its own fine-grained
 *   token (GITHUB_TOKEN, Contents read/write on that one repo only). The browser
 *   never sees any GitHub token.
 *
 * Secrets (wrangler secret put ...):
 *   GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_TOKEN, SESSION_SECRET
 * Vars (wrangler.toml [vars]):
 *   ALLOWED_LOGIN, NOTES_REPO, NOTES_BRANCH, FRONTEND_URL, ALLOWED_ORIGINS,
 *   SESSION_DAYS, SESSION_VERSION
 */

const GH_API = "https://api.github.com";
const MAX_NOTE_BYTES = 1_000_000;
const STATE_TTL_SECONDS = 30 * 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
    }

    try {
      if (url.pathname === "/auth/login") return await login(url, env);
      if (url.pathname === "/auth/callback") return await callback(request, url, env);

      if (url.pathname.startsWith("/api/")) {
        if (!cors && origin) return json({ error: "origin not allowed" }, 403);
        const session = await readSession(request, env);
        if (!session) return json({ error: "unauthorized" }, 401, cors);
        const res = await api(request, url, env, session);
        return withHeaders(res, cors);
      }

      if (url.pathname === "/") return json({ ok: true, service: "notebook" });
      return json({ error: "not found" }, 404, cors);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof HttpError ? err.message : "internal error";
      if (status === 500) console.error(err);
      return json({ error: message }, status, cors);
    }
  },
};

/* ------------------------------------------------------------------ auth */

async function login(url, env) {
  const ret = safeReturnUrl(url.searchParams.get("return"), env);
  // Signed, self-contained state (no cookie): survives slow logins and browsers that
  // drop cookies on the GitHub redirect. Login CSRF is harmless here because only
  // ALLOWED_LOGIN can ever obtain a session.
  const state = await signSession(
    { t: "state", n: randomHex(8), r: ret, exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS },
    env.SESSION_SECRET,
  );
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "false");
  // No scope: public profile is enough to learn the login name.
  return new Response(null, { status: 302, headers: { Location: authorize.toString(), "Cache-Control": "no-store" } });
}

async function callback(request, url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // Clears the state cookie set by older versions of this Worker.
  const clearCookie = "nb_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=0";
  const st = code && state ? await verifySigned(state, env.SESSION_SECRET) : null;
  if (!st || st.t !== "state" || !st.exp || st.exp < Date.now() / 1000) {
    return text("Login failed: the login link expired or is invalid. Go back to the notebook and sign in again.", 400, {
      "Set-Cookie": clearCookie,
    });
  }
  const ret = safeReturnUrl(st.r, env);

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "notebook-worker" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const tokenJson = await tokenRes.json().catch(() => ({}));
  if (!tokenJson.access_token) {
    // GitHub's error code (e.g. incorrect_client_credentials) is not secret and makes setup issues obvious.
    const reason = String(tokenJson.error || `HTTP ${tokenRes.status}`).replace(/[^a-z0-9_ ]/gi, "").slice(0, 60);
    return text(`Login failed: GitHub did not return a token (${reason}).`, 400, { "Set-Cookie": clearCookie });
  }

  const userRes = await fetch(`${GH_API}/user`, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "notebook-worker",
    },
  });
  const user = await userRes.json().catch(() => ({}));
  // The OAuth token was only needed for identity; revoke it right away (best effort).
  await revokeOAuthToken(env, tokenJson.access_token).catch(() => {});

  if (!user.login || user.login.toLowerCase() !== String(env.ALLOWED_LOGIN).toLowerCase()) {
    return text("This notebook is private.", 403, { "Set-Cookie": clearCookie });
  }

  const days = Number(env.SESSION_DAYS || 30);
  const token = await signSession(
    { sub: user.login, exp: Math.floor(Date.now() / 1000) + days * 86400, v: String(env.SESSION_VERSION || "1") },
    env.SESSION_SECRET,
  );
  return new Response(null, {
    status: 302,
    headers: { Location: `${ret}#nb_token=${token}`, "Set-Cookie": clearCookie, "Cache-Control": "no-store" },
  });
}

async function revokeOAuthToken(env, accessToken) {
  await fetch(`${GH_API}/applications/${env.GITHUB_CLIENT_ID}/token`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`)}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "notebook-worker",
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
}

function safeReturnUrl(candidate, env) {
  const fallback = env.FRONTEND_URL;
  if (!candidate) return fallback;
  try {
    const u = new URL(candidate);
    return allowedOrigins(env).includes(u.origin) ? `${u.origin}${u.pathname}` : fallback;
  } catch {
    return fallback;
  }
}

async function verifySigned(token, secret) {
  const m = String(token).match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify("HMAC", key, b64urlDecodeBytes(m[2]), new TextEncoder().encode(m[1]));
  if (!ok) return null;
  try {
    return JSON.parse(b64urlDecodeString(m[1]));
  } catch {
    return null;
  }
}

async function readSession(request, env) {
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(\S+)$/);
  if (!m) return null;
  const payload = await verifySigned(m[1], env.SESSION_SECRET);
  if (!payload || payload.t) return null; // reject state tokens
  if (!payload.exp || payload.exp < Date.now() / 1000) return null;
  if (String(payload.v) !== String(env.SESSION_VERSION || "1")) return null;
  if (String(payload.sub).toLowerCase() !== String(env.ALLOWED_LOGIN).toLowerCase()) return null;
  return payload;
}

async function signSession(payload, secret) {
  const payloadPart = b64urlEncodeString(JSON.stringify(payload));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  return `${payloadPart}.${b64urlEncodeBytes(new Uint8Array(sig))}`;
}

function hmacKey(secret) {
  if (!secret || secret.length < 32) throw new HttpError(500, "SESSION_SECRET missing or too short");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/* ------------------------------------------------------------------- api */

async function api(request, url, env, session) {
  const route = `${request.method} ${url.pathname}`;
  switch (route) {
    case "GET /api/me":
      return json({ login: session.sub, repo: env.NOTES_REPO, exp: session.exp });
    case "GET /api/tree":
      return json({ files: await listNotes(env) });
    case "GET /api/file":
      return json(await readNote(env, checkPath(url.searchParams.get("path"))));
    case "PUT /api/file": {
      const body = await readJson(request);
      return json(await writeNote(env, checkPath(body.path), body.content, body.sha, body.message));
    }
    case "DELETE /api/file": {
      const body = await readJson(request);
      await deleteNote(env, checkPath(body.path), body.sha);
      return json({ ok: true });
    }
    case "POST /api/rename": {
      const body = await readJson(request);
      const from = checkPath(body.from);
      const to = checkPath(body.to);
      if (from === to) throw new HttpError(400, "same path");
      const current = await readNote(env, from);
      if (body.sha && body.sha !== current.sha) throw new HttpError(409, "conflict");
      const created = await writeNote(env, to, current.content, null, `Rename ${from} -> ${to}`);
      await deleteNote(env, from, current.sha, `Rename ${from} -> ${to}`);
      return json(created);
    }
    default:
      throw new HttpError(404, "not found");
  }
}

async function listNotes(env) {
  const res = await gh(env, `/repos/${env.NOTES_REPO}/git/trees/${encodeURIComponent(branch(env))}?recursive=1`);
  if (res.status === 404 || res.status === 409) return []; // empty repo / no branch yet
  await ensureOk(res);
  const data = await res.json();
  return data.tree
    .filter((e) => e.type === "blob" && e.path.toLowerCase().endsWith(".md") && !hiddenPath(e.path))
    .map((e) => ({ path: e.path, sha: e.sha, size: e.size }));
}

async function readNote(env, path) {
  const res = await gh(env, `/repos/${env.NOTES_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch(env))}`);
  if (res.status === 404) throw new HttpError(404, "note not found");
  await ensureOk(res);
  const data = await res.json();
  if (Array.isArray(data) || data.type !== "file") throw new HttpError(400, "not a file");
  let b64 = data.content;
  if (!b64 && data.size > 0) {
    // Files > 1 MB: contents API omits the body, fetch the blob instead.
    const blob = await gh(env, `/repos/${env.NOTES_REPO}/git/blobs/${data.sha}`);
    await ensureOk(blob);
    b64 = (await blob.json()).content;
  }
  return { path, sha: data.sha, content: b64ToUtf8(b64 || "") };
}

async function writeNote(env, path, content, sha, message) {
  if (typeof content !== "string") throw new HttpError(400, "content must be a string");
  const encoded = utf8ToB64(content);
  if (encoded.length > MAX_NOTE_BYTES * 1.4) throw new HttpError(413, "note too large");
  const body = {
    message: cleanMessage(message) || `${sha ? "Update" : "Create"} ${path}`,
    content: encoded,
    branch: branch(env),
  };
  if (sha) body.sha = sha;
  const res = await gh(env, `/repos/${env.NOTES_REPO}/contents/${encodePath(path)}`, { method: "PUT", body });
  if (res.status === 409 || res.status === 422) throw new HttpError(409, sha ? "conflict" : "note already exists");
  await ensureOk(res);
  const data = await res.json();
  return { path, sha: data.content.sha, commit: data.commit.sha };
}

async function deleteNote(env, path, sha, message) {
  if (!sha) throw new HttpError(400, "sha required");
  const res = await gh(env, `/repos/${env.NOTES_REPO}/contents/${encodePath(path)}`, {
    method: "DELETE",
    body: { message: cleanMessage(message) || `Delete ${path}`, sha, branch: branch(env) },
  });
  if (res.status === 409 || res.status === 422) throw new HttpError(409, "conflict");
  if (res.status === 404) throw new HttpError(404, "note not found");
  await ensureOk(res);
}

function gh(env, path, { method = "GET", body } = {}) {
  return fetch(`${GH_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "notebook-worker",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function ensureOk(res) {
  if (res.ok) return;
  const detail = await res.text().catch(() => "");
  console.error("GitHub API error", res.status, detail.slice(0, 500));
  throw new HttpError(502, `GitHub API error ${res.status}`);
}

/* --------------------------------------------------------------- helpers */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function branch(env) {
  return env.NOTES_BRANCH || "main";
}

export function checkPath(path) {
  if (typeof path !== "string") throw new HttpError(400, "path required");
  const p = path.trim().replace(/^\/+/, "");
  if (!p || p.length > 200) throw new HttpError(400, "bad path");
  if (!p.toLowerCase().endsWith(".md")) throw new HttpError(400, "only .md notes");
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\\:*?"<>|]/.test(p)) throw new HttpError(400, "bad characters in path");
  const segments = p.split("/");
  if (segments.some((s) => !s || s === "." || s === ".." || s.startsWith(".") || s !== s.trim())) {
    throw new HttpError(400, "bad path");
  }
  return segments.join("/");
}

function hiddenPath(path) {
  return path.split("/").some((s) => s.startsWith("."));
}

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function cleanMessage(message) {
  return typeof message === "string" ? message.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
}

async function readJson(request) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_NOTE_BYTES * 2) throw new HttpError(413, "request too large");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function allowedOrigins(env) {
  const list = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  if (env.FRONTEND_URL) list.push(new URL(env.FRONTEND_URL).origin);
  return list;
}

function corsHeaders(origin, env) {
  if (!origin || !allowedOrigins(env).includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, PUT, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function withHeaders(res, extra) {
  if (!extra) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function json(data, status = 200, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(extra || {}) },
  });
}

function text(body, status, extra) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...(extra || {}) } });
}

function randomHex(bytes) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBinary(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

function binaryToBytes(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8ToB64(str) {
  return btoa(bytesToBinary(new TextEncoder().encode(str)));
}

export function b64ToUtf8(b64) {
  return new TextDecoder().decode(binaryToBytes(atob(b64.replace(/\s/g, ""))));
}

function b64urlEncodeBytes(bytes) {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return binaryToBytes(atob(b64));
}

function b64urlEncodeString(str) {
  return b64urlEncodeBytes(new TextEncoder().encode(str));
}

function b64urlDecodeString(s) {
  return new TextDecoder().decode(b64urlDecodeBytes(s));
}
