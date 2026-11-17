// Local preview without Jekyll or Cloudflare:
//   - Worker on http://localhost:8787 backed by an in-memory fake GitHub
//   - notes page on http://localhost:4000/notes/ (uses the live site CSS for the theme)
// Prints a ready-to-open URL that already carries a session token.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeGitHub, testEnv } from "./fake-github.mjs";
import worker, { utf8ToB64 } from "../worker.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "../..");
const gh = installFakeGitHub();
gh.files.set("README.md", { content: utf8ToB64("# Notes\n\nPrivate notebook."), sha: "a".repeat(40) });
gh.files.set("research/structured-pruning.md", {
  content: utf8ToB64("# Structured pruning\n\n- remove whole heads\n- **physically** shrink tensors\n\n```python\nprint('hi')\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"),
  sha: "b".repeat(40),
});
gh.files.set("research/pruning/heads/attention-heads.md", { content: utf8ToB64("# Heads\n"), sha: "d".repeat(40) });
gh.files.set("research/pruning/channels.md", { content: utf8ToB64("# Channels\n"), sha: "e".repeat(40) });
// Images are stored base64-encoded, like GitHub's contents API.
const DIAGRAM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90" viewBox="0 0 240 90">' +
  '<rect width="240" height="90" rx="10" fill="#0f766e"/>' +
  '<text x="120" y="54" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">diagram.svg</text></svg>';
gh.files.set("research/images/diagram.svg", { content: Buffer.from(DIAGRAM_SVG).toString("base64"), sha: "f".repeat(40) });
// 1x1 PNG.
gh.files.set("research/images/pixel.png", {
  content: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  sha: "1".repeat(40),
});
gh.files.set("research/images-demo.md", {
  content: utf8ToB64(
    "# Images\n\nRelative to this note:\n\n![diagram](images/diagram.svg)\n\nSame image via ./ and from the repo root:\n\n" +
      "![dot](./images/pixel.png) ![root](/research/images/diagram.svg)\n\nMissing: ![gone](images/missing.png)\n\nOutside the repo: ![escape](../../x.png)\n",
  ),
  sha: "2".repeat(40),
});
gh.files.set("daily/2026-11-10 周一.md", { content: utf8ToB64("# 2026-11-10\n\n今天的笔记。"), sha: "c".repeat(40) });

const env = { ...testEnv, ALLOWED_ORIGINS: "http://localhost:4000,http://127.0.0.1:4000" };

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request("http://localhost:8787" + req.url, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
    });
    const r = await worker.fetch(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  })
  .listen(8787);

function renderPage() {
  const src = fs.readFileSync(path.join(site, "_pages/notes.html"), "utf8").replace(/^---[\s\S]*?---\n/, "");
  const content = src
    .replace("{% include base_path %}", "")
    .replace(/\{\{ base_path \}\}/g, "")
    .replace(/\{\{ site\.time[^}]*\}\}/g, String(Date.now()))
    .replace("{{ page.notes_api }}", "http://localhost:8787");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notebook (dev)</title>
<link rel="stylesheet" href="https://twwinde.github.io/assets/css/main.css">
<script>try{if(localStorage.getItem("theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}</script>
</head><body><div class="masthead"><div style="padding:22px 1.25rem;font-weight:700">Wenwu Tang（唐文武） — dev preview</div></div>
${content}</body></html>`;
}

const types = { ".js": "text/javascript", ".css": "text/css" };
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost:4000");
    if (url.pathname === "/notes/" || url.pathname === "/notes") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(renderPage());
    }
    if (url.pathname === "/assets/js/notes.js" || url.pathname === "/assets/css/notes.css") {
      res.writeHead(200, { "Content-Type": types[path.extname(url.pathname)] });
      return res.end(fs.readFileSync(path.join(site, url.pathname)));
    }
    res.writeHead(404).end("not found");
  })
  .listen(4000);

// Mint a session the same way the OAuth callback would.
const start = await worker.fetch(new Request("http://localhost:8787/auth/login?return=http://localhost:4000/notes/"), env);
const state = new URL(start.headers.get("Location")).searchParams.get("state");
const cb = await worker.fetch(new Request(`http://localhost:8787/auth/callback?code=good&state=${state}`), env);
console.log("Open:", cb.headers.get("Location"));
