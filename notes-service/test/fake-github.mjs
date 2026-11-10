// In-memory stand-in for the GitHub endpoints the Worker uses. Test-only.
const realFetch = globalThis.fetch;

export function installFakeGitHub({ login = "TWWinde", repo = "TWWinde/notes", branch = "main" } = {}) {
  const files = new Map(); // path -> { content(base64), sha }
  let n = 0;
  const sha = () => (++n).toString(16).padStart(40, "0");
  const state = { files, login, calls: [] };

  const reply = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    if (url.host !== "api.github.com" && url.host !== "github.com") return realFetch(input, init);
    state.calls.push(`${method} ${url.pathname}`);

    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
      const body = JSON.parse(init.body);
      return reply(200, body.code === "good" || body.code === "intruder" ? { access_token: `oauth-${body.code}` } : { error: "bad_verification_code" });
    }
    if (url.pathname === "/user") {
      const auth = new Headers(init.headers).get("Authorization");
      return reply(200, { login: auth === "Bearer oauth-intruder" ? "someone-else" : state.login });
    }
    if (url.pathname.startsWith("/applications/")) return new Response(null, { status: 204 });

    const auth = new Headers(init.headers).get("Authorization");
    if (auth !== "Bearer pat-test") return reply(401, { message: "Bad credentials" });

    const prefix = `/repos/${repo}`;
    if (url.pathname === `${prefix}/git/trees/${branch}`) {
      if (!files.size) return reply(409, { message: "Git Repository is empty." });
      return reply(200, {
        tree: [...files].map(([path, f]) => ({ path, type: "blob", sha: f.sha, size: f.content.length })),
      });
    }
    if (url.pathname.startsWith(`${prefix}/contents/`)) {
      const path = url.pathname.slice(`${prefix}/contents/`.length).split("/").map(decodeURIComponent).join("/");
      const f = files.get(path);
      if (method === "GET") {
        if (!f) return reply(404, { message: "Not Found" });
        // GitHub wraps base64 at 60 chars with newlines.
        return reply(200, { type: "file", path, sha: f.sha, size: 1, content: f.content.replace(/(.{60})/g, "$1\n") });
      }
      const body = JSON.parse(init.body);
      if (method === "PUT") {
        if (f && body.sha !== f.sha) return reply(f && !body.sha ? 422 : 409, { message: "sha mismatch" });
        if (!f && body.sha) return reply(404, { message: "Not Found" });
        const next = { content: body.content, sha: sha() };
        files.set(path, next);
        return reply(f ? 200 : 201, { content: { path, sha: next.sha }, commit: { sha: sha() } });
      }
      if (method === "DELETE") {
        if (!f) return reply(404, { message: "Not Found" });
        if (body.sha !== f.sha) return reply(409, { message: "sha mismatch" });
        files.delete(path);
        return reply(200, { commit: { sha: sha() } });
      }
    }
    return reply(404, { message: `fake: unhandled ${method} ${url.pathname}` });
  };
  return state;
}

export const testEnv = {
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  GITHUB_TOKEN: "pat-test",
  SESSION_SECRET: "x".repeat(40),
  ALLOWED_LOGIN: "TWWinde",
  NOTES_REPO: "TWWinde/notes",
  NOTES_BRANCH: "main",
  FRONTEND_URL: "https://twwinde.github.io/notes/",
  ALLOWED_ORIGINS: "http://localhost:4000",
  SESSION_DAYS: "30",
  SESSION_VERSION: "1",
};
