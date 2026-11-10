import { test } from "node:test";
import assert from "node:assert/strict";
import { installFakeGitHub, testEnv as env } from "./fake-github.mjs";
import worker, { checkPath, utf8ToB64, b64ToUtf8 } from "../worker.js";

const gh = installFakeGitHub();
const W = "https://nb.example.workers.dev";
const call = (path, init = {}) => worker.fetch(new Request(W + path, init), env);

async function loginAs(code) {
  const start = await call("/auth/login?return=" + encodeURIComponent("http://localhost:4000/notes/"));
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get("Location"));
  assert.equal(loc.origin + loc.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(loc.searchParams.get("scope"), null);
  const state = loc.searchParams.get("state");
  return call(`/auth/callback?code=${code}&state=${state}`);
}

let token;
const authed = (path, init = {}) =>
  call(path, { ...init, headers: { Authorization: "Bearer " + token, Origin: "http://localhost:4000", "Content-Type": "application/json", ...(init.headers || {}) } });

test("base64 round-trips UTF-8", () => {
  const s = "中文笔记 ✓ emoji 🚀\nline2";
  assert.equal(b64ToUtf8(utf8ToB64(s)), s);
});

test("path validation", () => {
  assert.equal(checkPath("/ideas/今天.md"), "ideas/今天.md");
  for (const bad of ["../x.md", "a/../b.md", ".github/x.md", "a//b.md", "x.txt", "", "a\\b.md", 3]) {
    assert.throws(() => checkPath(bad), `${bad} should be rejected`);
  }
});

test("callback rejects bad, tampered or expired state", async () => {
  assert.equal((await call("/auth/callback?code=good&state=abc")).status, 400);
  const start = await call("/auth/login");
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  assert.equal((await call(`/auth/callback?code=good&state=${state.slice(0, -2)}AA`)).status, 400);
  const realNow = Date.now;
  Date.now = () => realNow() + 31 * 60 * 1000;
  try {
    assert.equal((await call(`/auth/callback?code=good&state=${state}`)).status, 400);
  } finally {
    Date.now = realNow;
  }
});

test("a state token cannot be used as a session", async () => {
  const start = await call("/auth/login");
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  assert.equal((await call("/api/me", { headers: { Authorization: "Bearer " + state } })).status, 401);
});

test("other GitHub users are refused", async () => {
  const res = await loginAs("intruder");
  assert.equal(res.status, 403);
});

test("owner login returns a session to the allowed return URL", async () => {
  const res = await loginAs("good");
  assert.equal(res.status, 302);
  const loc = res.headers.get("Location");
  assert.match(loc, /^http:\/\/localhost:4000\/notes\/#nb_token=/);
  token = loc.split("#nb_token=")[1];
});

test("foreign return URL falls back to FRONTEND_URL", async () => {
  const start = await call("/auth/login?return=" + encodeURIComponent("https://evil.example/steal"));
  const state = new URL(start.headers.get("Location")).searchParams.get("state");
  const res = await call(`/auth/callback?code=good&state=${state}`);
  assert.match(res.headers.get("Location"), /^https:\/\/twwinde\.github\.io\/notes\/#nb_token=/);
});

test("API needs a valid session", async () => {
  assert.equal((await call("/api/me")).status, 401);
  assert.equal((await call("/api/me", { headers: { Authorization: "Bearer " + token.slice(0, -2) + "AA" } })).status, 401);
  const old = await worker.fetch(new Request(W + "/api/me", { headers: { Authorization: "Bearer " + token } }), { ...env, SESSION_VERSION: "2" });
  assert.equal(old.status, 401, "bumping SESSION_VERSION logs everyone out");
  const me = await authed("/api/me");
  assert.equal(me.status, 200);
  assert.equal((await me.json()).login, "TWWinde");
  assert.equal(me.headers.get("Access-Control-Allow-Origin"), "http://localhost:4000");
});

test("disallowed origin gets no access", async () => {
  const res = await authed("/api/me", { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 403);
  const pre = await call("/api/me", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(pre.status, 403);
});

test("create, list, read, update, conflict, rename, delete", async () => {
  assert.deepEqual(await (await authed("/api/tree")).json(), { files: [] });

  const content = "# 研究笔记\n\n" + "长文本 ".repeat(50);
  let res = await authed("/api/file", { method: "PUT", body: JSON.stringify({ path: "research/今天.md", content }) });
  assert.equal(res.status, 200);
  const { sha } = await res.json();

  res = await authed("/api/file", { method: "PUT", body: JSON.stringify({ path: "research/今天.md", content: "dup" }) });
  assert.equal(res.status, 409, "creating over an existing note is a conflict");

  const tree = await (await authed("/api/tree")).json();
  assert.deepEqual(tree.files.map((f) => f.path), ["research/今天.md"]);

  const read = await (await authed("/api/file?path=" + encodeURIComponent("research/今天.md"))).json();
  assert.equal(read.content, content);
  assert.equal(read.sha, sha);

  res = await authed("/api/file", { method: "PUT", body: JSON.stringify({ path: "research/今天.md", content: "v2", sha }) });
  const v2 = await res.json();
  assert.notEqual(v2.sha, sha);

  res = await authed("/api/file", { method: "PUT", body: JSON.stringify({ path: "research/今天.md", content: "stale", sha }) });
  assert.equal(res.status, 409, "stale sha is a conflict");

  res = await authed("/api/rename", { method: "POST", body: JSON.stringify({ from: "research/今天.md", to: "archive/old.md", sha: v2.sha }) });
  assert.equal(res.status, 200);
  const renamed = await res.json();
  assert.deepEqual([...gh.files.keys()], ["archive/old.md"]);

  res = await authed("/api/file", { method: "DELETE", body: JSON.stringify({ path: "archive/old.md", sha: renamed.sha }) });
  assert.equal(res.status, 200);
  assert.equal(gh.files.size, 0);
});

test("bad paths are rejected before touching GitHub", async () => {
  const before = gh.calls.length;
  const res = await authed("/api/file", { method: "PUT", body: JSON.stringify({ path: "../escape.md", content: "x" }) });
  assert.equal(res.status, 400);
  assert.equal(gh.calls.length, before);
});
