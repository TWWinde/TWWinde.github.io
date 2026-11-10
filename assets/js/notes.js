/* Notebook front end: talks to the notes-service Worker, which stores notes in a private GitHub repo. */
(function () {
  "use strict";

  const root = document.getElementById("notebook");
  if (!root) return;

  const API = (root.dataset.api || "").replace(/\/+$/, "");
  const TOKEN_KEY = "nb_token";
  const LAST_KEY = "nb_last";
  const VIEW_KEY = "nb_view";
  const DRAFT_PREFIX = "nb_draft:";
  const AUTOSAVE_MS = 3000;

  const $ = (id) => document.getElementById(id);
  const el = {
    signin: $("nb-signin"), signinError: $("nb-signin-error"), login: $("nb-login"),
    app: $("nb-app"), side: $("nb-side"), search: $("nb-search"), newBtn: $("nb-new"), tree: $("nb-tree"),
    user: $("nb-user"), logout: $("nb-logout"), toggleSide: $("nb-toggle-side"),
    path: $("nb-path"), status: $("nb-status"), save: $("nb-save"), del: $("nb-delete"),
    conflict: $("nb-conflict"), conflictLoad: $("nb-conflict-load"), conflictOverwrite: $("nb-conflict-overwrite"),
    panes: $("nb-panes"), editor: $("nb-editor"), preview: $("nb-preview"),
  };

  const state = {
    files: [],
    current: null, // { path, sha, saved } — saved = last content known to be on GitHub
    dirty: false,
    saving: null, // Promise while a save is in flight
    timer: null,
  };

  /* -------------------------------------------------------------- storage */
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };
  const readDraft = (path) => { try { return JSON.parse(store.get(DRAFT_PREFIX + path)); } catch { return null; } };
  const writeDraft = (path, content, baseSha) => store.set(DRAFT_PREFIX + path, JSON.stringify({ content, baseSha, ts: Date.now() }));
  const clearDraft = (path) => store.del(DRAFT_PREFIX + path);

  /* ------------------------------------------------------------------ api */
  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(method, path, body) {
    const token = store.get(TOKEN_KEY);
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "offline");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { signedOut("Your session expired. Please sign in again."); throw new ApiError(401, "unauthorized"); }
    if (!res.ok) throw new ApiError(res.status, data.error || "HTTP " + res.status);
    return data;
  }

  /* ----------------------------------------------------------------- auth */
  function takeTokenFromHash() {
    const m = location.hash.match(/nb_token=([A-Za-z0-9_.-]+)/);
    if (!m) return;
    store.set(TOKEN_KEY, m[1]);
    history.replaceState(null, "", location.pathname + location.search);
  }

  function signedOut(message) {
    store.del(TOKEN_KEY);
    el.app.hidden = true;
    el.signin.hidden = false;
    el.signinError.hidden = !message;
    el.signinError.textContent = message || "";
  }

  el.login.addEventListener("click", () => {
    if (!API || API.includes("REPLACE-ME")) {
      el.signinError.hidden = false;
      el.signinError.textContent = "Notes service URL is not configured yet (notes_api in _pages/notes.html).";
      return;
    }
    location.href = API + "/auth/login?return=" + encodeURIComponent(location.origin + location.pathname);
  });

  el.logout.addEventListener("click", async () => {
    if (state.dirty) await saveNow();
    signedOut();
  });

  /* ----------------------------------------------------------------- tree */
  const COLLAPSED_KEY = "nb_collapsed";
  const collapsed = new Set((() => { try { return JSON.parse(store.get(COLLAPSED_KEY)) || []; } catch { return []; } })());
  const saveCollapsed = () => store.set(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const baseOf = (path) => path.slice(path.lastIndexOf("/") + 1);
  let dragPath = null;

  function buildTree(files) {
    const root = { path: "", dirs: new Map(), files: [] };
    for (const f of files) {
      const parts = f.path.split("/");
      let node = root;
      for (const name of parts.slice(0, -1)) {
        if (!node.dirs.has(name)) node.dirs.set(name, { name, path: node.path ? node.path + "/" + name : name, dirs: new Map(), files: [] });
        node = node.dirs.get(name);
      }
      node.files.push(f);
    }
    return root;
  }

  function renderTree() {
    const q = el.search.value.trim().toLowerCase();
    const files = state.files.filter((f) => !q || f.path.toLowerCase().includes(q));
    el.tree.textContent = "";
    el.tree.dataset.dropDir = "";
    if (!files.length) {
      const p = document.createElement("p");
      p.className = "nb-tree__empty";
      p.textContent = q ? "No matching notes." : "No notes yet. Click New.";
      el.tree.append(p);
      return;
    }
    el.tree.append(renderNode(buildTree(files), 0, !!q));
  }

  function renderNode(node, depth, expandAll) {
    const ul = document.createElement("ul");
    const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    for (const dir of [...node.dirs.values()].sort((a, b) => byName(a.name, b.name))) {
      const open = expandAll || !collapsed.has(dir.path);
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "nb-folder";
      row.dataset.dropDir = dir.path;
      row.style.setProperty("--depth", depth);
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "nb-folder__toggle";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.title = dir.path;
      const caret = document.createElement("span");
      caret.className = "nb-caret";
      caret.setAttribute("aria-hidden", "true");
      toggle.append(caret, document.createTextNode(dir.name));
      toggle.addEventListener("click", () => {
        if (collapsed.has(dir.path)) collapsed.delete(dir.path); else collapsed.add(dir.path);
        saveCollapsed();
        renderTree();
      });
      const add = document.createElement("button");
      add.type = "button";
      add.className = "nb-folder__add";
      add.title = "New note in " + dir.path;
      add.setAttribute("aria-label", add.title);
      add.textContent = "+";
      add.addEventListener("click", () => createNote(dir.path + "/"));
      row.append(toggle, add);
      li.append(row);
      if (open) li.append(renderNode(dir, depth + 1, expandAll));
      ul.append(li);
    }
    for (const f of [...node.files].sort((a, b) => byName(a.path, b.path))) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "nb-note";
      b.textContent = baseOf(f.path).replace(/\.md$/i, "");
      b.title = f.path;
      b.style.setProperty("--depth", depth);
      b.dataset.dropDir = node.path;
      b.draggable = true;
      if (state.current && state.current.path === f.path) b.setAttribute("aria-current", "true");
      if (readDraft(f.path)) b.classList.add("has-draft");
      b.addEventListener("click", () => openNote(f.path));
      b.addEventListener("dragstart", (e) => {
        dragPath = f.path;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", f.path);
        b.classList.add("is-dragging");
        el.tree.classList.add("is-dragging");
      });
      b.addEventListener("dragend", () => {
        dragPath = null;
        b.classList.remove("is-dragging");
        el.tree.classList.remove("is-dragging");
        clearDropHighlight();
      });
      li.append(b);
      ul.append(li);
    }
    return ul;
  }

  /* drag & drop: drop a note on a folder (or a note inside it) to move it there; on empty space for top level */
  let hoverTimer = null, hoverDir = null;
  function dropDirFor(target) {
    const hit = target.closest && target.closest("[data-drop-dir]");
    return hit && el.tree.contains(hit) ? hit.dataset.dropDir : null;
  }
  function clearDropHighlight() {
    clearTimeout(hoverTimer);
    hoverDir = null;
    for (const n of el.tree.querySelectorAll(".is-drop")) n.classList.remove("is-drop");
    el.tree.classList.remove("is-drop");
  }
  function highlightDrop(dir) {
    if (dir === hoverDir) return;
    clearDropHighlight();
    hoverDir = dir;
    if (dir === "") { el.tree.classList.add("is-drop"); return; }
    const row = [...el.tree.querySelectorAll(".nb-folder")].find((r) => r.dataset.dropDir === dir);
    if (row) row.classList.add("is-drop");
    // Hovering over a collapsed folder opens it so you can drop deeper.
    if (collapsed.has(dir)) hoverTimer = setTimeout(() => { collapsed.delete(dir); saveCollapsed(); renderTree(); hoverDir = null; }, 700);
  }
  el.tree.addEventListener("dragover", (e) => {
    if (!dragPath) return;
    const dir = dropDirFor(e.target);
    if (dir == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dir === dirOf(dragPath) ? "none" : "move";
    highlightDrop(dir);
  });
  el.tree.addEventListener("dragleave", (e) => {
    if (!el.tree.contains(e.relatedTarget)) clearDropHighlight();
  });
  el.tree.addEventListener("drop", (e) => {
    if (!dragPath) return;
    e.preventDefault();
    const from = dragPath;
    const dir = dropDirFor(e.target);
    clearDropHighlight();
    el.tree.classList.remove("is-dragging");
    dragPath = null;
    if (dir == null || dir === dirOf(from)) return;
    moveNote(from, (dir ? dir + "/" : "") + baseOf(from));
  });

  async function loadTree() {
    const data = await api("GET", "/api/tree");
    state.files = data.files;
    renderTree();
  }

  el.search.addEventListener("input", renderTree);

  /* --------------------------------------------------------------- editor */
  function setStatus(text, kind) {
    el.status.textContent = text;
    el.status.dataset.kind = kind || "";
  }

  function renderPreview() {
    if (el.panes.dataset.view === "edit") return;
    const html = window.marked ? window.marked.parse(el.editor.value) : el.editor.value;
    el.preview.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html) : "";
  }

  function setView(view) {
    el.panes.dataset.view = view;
    for (const b of document.querySelectorAll(".nb-views button")) b.setAttribute("aria-pressed", String(b.dataset.view === view));
    store.set(VIEW_KEY, view);
    renderPreview();
  }
  for (const b of document.querySelectorAll(".nb-views button")) b.addEventListener("click", () => setView(b.dataset.view));

  function setEditing(enabled) {
    el.editor.disabled = !enabled;
    el.path.disabled = !enabled;
    el.save.disabled = !enabled;
    el.del.disabled = !enabled;
  }

  async function openNote(path) {
    if (state.current && state.current.path === path) return closeSideOnMobile();
    if (state.dirty) await saveNow();
    if (state.dirty) {
      if (!confirm("This note could not be saved to GitHub yet (a local draft is kept). Open another note anyway?")) return;
    }
    setStatus("Loading…");
    let note;
    try {
      note = await api("GET", "/api/file?path=" + encodeURIComponent(path));
    } catch (e) {
      setStatus(e.status === 0 ? "Offline" : "Could not load: " + e.message, "error");
      return;
    }
    state.current = { path: note.path, sha: note.sha, saved: note.content };
    el.conflict.hidden = true;
    el.path.value = note.path;
    let content = note.content;
    const draft = readDraft(note.path);
    if (draft && draft.content !== note.content) {
      const sameBase = draft.baseSha === note.sha;
      if (sameBase || confirm("You have unsaved local changes to this note from " + new Date(draft.ts).toLocaleString() +
          ", but the note changed on GitHub since. Restore your local version? (Cancel keeps the GitHub version and discards the draft.)")) {
        content = draft.content;
      } else {
        clearDraft(note.path);
      }
    } else if (draft) {
      clearDraft(note.path);
    }
    el.editor.value = content;
    state.dirty = content !== note.content;
    setEditing(true);
    setStatus(state.dirty ? "Unsaved draft restored" : "Saved", state.dirty ? "dirty" : "ok");
    if (state.dirty) scheduleSave();
    store.set(LAST_KEY, note.path);
    renderPreview();
    renderTree();
    closeSideOnMobile();
  }

  let draftTimer = null;
  el.editor.addEventListener("input", () => {
    if (!state.current) return;
    state.dirty = el.editor.value !== state.current.saved;
    setStatus(state.dirty ? "Unsaved" : "Saved", state.dirty ? "dirty" : "ok");
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      if (state.dirty) writeDraft(state.current.path, el.editor.value, state.current.sha);
      else clearDraft(state.current.path);
    }, 300);
    renderPreview();
    scheduleSave();
  });

  // Tab inserts two spaces instead of leaving the editor.
  el.editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      el.editor.setRangeText("  ", el.editor.selectionStart, el.editor.selectionEnd, "end");
      el.editor.dispatchEvent(new Event("input"));
    }
  });

  function scheduleSave() {
    clearTimeout(state.timer);
    state.timer = setTimeout(saveNow, AUTOSAVE_MS);
  }

  async function saveNow(force) {
    clearTimeout(state.timer);
    if (state.saving) { await state.saving; if (!state.dirty) return; }
    if (!state.current || !state.dirty) return;
    const note = state.current;
    const content = el.editor.value;
    setStatus("Saving…", "busy");
    state.saving = (async () => {
      try {
        let sha = note.sha;
        if (force) sha = (await api("GET", "/api/file?path=" + encodeURIComponent(note.path))).sha;
        const res = await api("PUT", "/api/file", { path: note.path, content, sha });
        note.sha = res.sha;
        note.saved = content;
        const f = state.files.find((x) => x.path === note.path);
        if (f) f.sha = res.sha;
        el.conflict.hidden = true;
        if (state.current === note) {
          state.dirty = el.editor.value !== content;
          if (state.dirty) { writeDraft(note.path, el.editor.value, note.sha); scheduleSave(); setStatus("Unsaved", "dirty"); }
          else { clearDraft(note.path); setStatus("Saved " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), "ok"); }
        }
        renderTree();
      } catch (e) {
        writeDraft(note.path, content, note.sha);
        if (e.status === 409) { el.conflict.hidden = false; setStatus("Conflict", "error"); }
        else if (e.status === 0) { setStatus("Offline — kept locally", "error"); state.timer = setTimeout(saveNow, 15000); }
        else if (e.status !== 401) setStatus("Save failed: " + e.message, "error");
      } finally {
        state.saving = null;
      }
    })();
    await state.saving;
  }

  el.save.addEventListener("click", () => saveNow());
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !el.app.hidden) {
      e.preventDefault();
      saveNow();
    }
  });

  el.conflictOverwrite.addEventListener("click", () => {
    if (confirm("Replace the version on GitHub with what is in this editor?")) saveNow(true);
  });

  el.conflictLoad.addEventListener("click", async () => {
    const note = state.current;
    const mine = el.editor.value;
    const copyPath = note.path.replace(/\.md$/i, "") + " (conflict " + localStamp() + ").md";
    try {
      await api("PUT", "/api/file", { path: copyPath, content: mine });
      clearDraft(note.path);
      state.dirty = false;
      state.current = null;
      await loadTree();
      await openNote(note.path);
      setStatus("Your version saved as a copy", "ok");
    } catch (e) {
      setStatus("Could not save copy: " + e.message, "error");
    }
  });

  function localStamp() {
    const d = new Date(), p = (x) => String(x).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + "-" + p(d.getMinutes());
  }

  /* ------------------------------------------------------ create / rename */
  function normalizePath(input) {
    let p = input.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
    if (!p) return "";
    if (!/\.md$/i.test(p)) p += ".md";
    return p;
  }

  async function createNote(prefix) {
    const suggestion = prefix || localStamp().slice(0, 10) + " ";
    const name = prompt("New note name (use folder/name for folders):", suggestion);
    if (name == null || /\/\s*$/.test(name)) return;
    const path = normalizePath(name);
    if (!path) return;
    if (state.files.some((f) => f.path === path)) return openNote(path);
    if (state.dirty) await saveNow();
    const title = baseOf(path).replace(/\.md$/i, "");
    try {
      setStatus("Creating…", "busy");
      await api("PUT", "/api/file", { path, content: "# " + title + "\n\n" });
      for (let d = dirOf(path); d; d = dirOf(d)) collapsed.delete(d);
      saveCollapsed();
      await loadTree();
      state.current = null;
      await openNote(path);
      el.editor.focus();
      el.editor.setSelectionRange(el.editor.value.length, el.editor.value.length);
    } catch (e) {
      setStatus("Create failed: " + e.message, "error");
    }
  }
  el.newBtn.addEventListener("click", () => createNote());

  /* Move or rename a note (also used by drag & drop). Returns true on success. */
  async function moveNote(from, to) {
    if (!to || to === from) return false;
    if (state.files.some((f) => f.path === to)) { alert('"' + to + '" already exists.'); return false; }
    const isCurrent = !!state.current && state.current.path === from;
    if (isCurrent && state.dirty) await saveNow();
    if (isCurrent && state.dirty) { setStatus("Save first, then move", "error"); return false; }
    const entry = state.files.find((f) => f.path === from);
    const sha = isCurrent ? state.current.sha : entry && entry.sha;
    try {
      setStatus("Moving…", "busy");
      const res = await api("POST", "/api/rename", { from, to, sha });
      const draft = store.get(DRAFT_PREFIX + from);
      if (draft && !isCurrent) store.set(DRAFT_PREFIX + to, draft);
      clearDraft(from);
      if (isCurrent) {
        state.current = { path: res.path, sha: res.sha, saved: state.current.saved };
        el.path.value = res.path;
      }
      if (store.get(LAST_KEY) === from) store.set(LAST_KEY, res.path);
      for (let d = dirOf(res.path); d; d = dirOf(d)) collapsed.delete(d);
      saveCollapsed();
      await loadTree();
      setStatus(dirOf(from) === dirOf(res.path) ? "Renamed" : "Moved to " + (dirOf(res.path) || "top level"), "ok");
      return true;
    } catch (e) {
      setStatus("Move failed: " + (e.status === 409 ? "note changed elsewhere, reload" : e.message), "error");
      return false;
    }
  }

  async function renameCurrent() {
    const note = state.current;
    if (!note) return;
    const ok = await moveNote(note.path, normalizePath(el.path.value));
    if (!ok && state.current) el.path.value = state.current.path;
  }
  el.path.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); el.path.blur(); }
    if (e.key === "Escape") { el.path.value = state.current ? state.current.path : ""; el.path.blur(); }
  });
  el.path.addEventListener("change", renameCurrent);

  el.del.addEventListener("click", async () => {
    const note = state.current;
    if (!note || !confirm('Delete "' + note.path + '"? It stays in the GitHub repo history.')) return;
    clearTimeout(state.timer);
    try {
      await api("DELETE", "/api/file", { path: note.path, sha: note.sha });
      clearDraft(note.path);
      state.current = null;
      state.dirty = false;
      el.editor.value = "";
      el.path.value = "";
      setEditing(false);
      renderPreview();
      store.del(LAST_KEY);
      await loadTree();
      setStatus("Deleted", "ok");
    } catch (e) {
      setStatus("Delete failed: " + e.message, "error");
    }
  });

  /* --------------------------------------------------------------- layout */
  const mobile = () => window.matchMedia("(max-width: 760px)").matches;
  function closeSideOnMobile() { if (mobile()) root.classList.remove("nb--side-open"); }
  el.toggleSide.addEventListener("click", () => root.classList.toggle("nb--side-open"));

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      if (state.current) writeDraft(state.current.path, el.editor.value, state.current.sha);
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && state.dirty) saveNow(); });

  /* ----------------------------------------------------------------- boot */
  async function boot() {
    takeTokenFromHash();
    setView(store.get(VIEW_KEY) || (mobile() ? "edit" : "split"));
    if (!store.get(TOKEN_KEY)) return signedOut();
    let me;
    try {
      me = await api("GET", "/api/me");
    } catch (e) {
      if (e.status !== 401) {
        el.signin.hidden = false;
        el.signinError.hidden = false;
        el.signinError.textContent = e.status === 0 ? "Cannot reach the notes service." : "Error: " + e.message;
      }
      return;
    }
    // Signed in: from here on, problems are shown inside the notebook, not on the sign-in card.
    el.user.textContent = me.login;
    el.signin.hidden = true;
    el.app.hidden = false;
    try {
      await loadTree();
    } catch (e) {
      if (e.status === 401) return;
      setStatus(e.status === 0 ? "Offline" : "Could not load notes: " + e.message, "error");
      el.tree.textContent = "";
      const p = document.createElement("p");
      p.className = "nb-tree__empty";
      p.textContent = "Could not load notes. Reload the page to retry.";
      el.tree.append(p);
      return;
    }
    const last = store.get(LAST_KEY);
    if (last && state.files.some((f) => f.path === last)) await openNote(last);
    else if (mobile()) root.classList.add("nb--side-open");
  }
  boot();
})();
