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
    app: $("nb-app"), side: $("nb-side"), search: $("nb-search"), newBtn: $("nb-new"), newFolderBtn: $("nb-new-folder"), tree: $("nb-tree"),
    user: $("nb-user"), logout: $("nb-logout"), toggleSide: $("nb-toggle-side"),
    path: $("nb-path"), status: $("nb-status"), save: $("nb-save"), del: $("nb-delete"),
    conflict: $("nb-conflict"), conflictLoad: $("nb-conflict-load"), conflictOverwrite: $("nb-conflict-overwrite"),
    panes: $("nb-panes"), editor: $("nb-editor"), preview: $("nb-preview"),
  };

  const state = {
    files: [],
    folders: [], // explicit folders [{ path, sha }] — kept by a placeholder file, may be empty
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
  const FOLDER_PLUS_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" d="M1.5 4V12.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V5.5a1 1 0 0 0-1-1H8L6.5 2.5h-4a1 1 0 0 0-1 1z"/><path stroke="currentColor" stroke-width="1.4" d="M8 7v4.5M5.75 9.25h4.5"/></svg>';

  function buildTree(files, folders) {
    const root = { path: "", dirs: new Map(), files: [] };
    const ensure = (parts) => {
      let node = root;
      for (const name of parts) {
        if (!node.dirs.has(name)) node.dirs.set(name, { name, path: node.path ? node.path + "/" + name : name, dirs: new Map(), files: [] });
        node = node.dirs.get(name);
      }
      return node;
    };
    for (const d of folders) ensure(d.path.split("/")).keep = d.sha;
    for (const f of files) ensure(f.path.split("/").slice(0, -1)).files.push(f);
    return root;
  }

  function renderTree() {
    const q = el.search.value.trim().toLowerCase();
    const files = state.files.filter((f) => !q || f.path.toLowerCase().includes(q));
    const folders = q ? state.folders.filter((d) => d.path.toLowerCase().includes(q)) : state.folders;
    el.tree.textContent = "";
    el.tree.dataset.dropDir = "";
    if (!files.length && !folders.length) {
      const p = document.createElement("p");
      p.className = "nb-tree__empty";
      p.textContent = q ? "No matching notes." : "No notes yet. Click New.";
      el.tree.append(p);
      return;
    }
    el.tree.append(renderNode(buildTree(files, folders), 0, !!q));
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
      const actions = document.createElement("span");
      actions.className = "nb-folder__actions";
      const action = (label, title, fn) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "nb-folder__add";
        b.title = title;
        b.setAttribute("aria-label", title);
        b.innerHTML = label;
        b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
        actions.append(b);
      };
      action("+", "New note in " + dir.path, () => createNote(dir.path + "/"));
      action(FOLDER_PLUS_SVG, "New folder in " + dir.path, () => createFolder(dir.path));
      if (dir.keep && !dir.files.length && !dir.dirs.size) action("&times;", "Delete empty folder " + dir.path, () => deleteFolder(dir));
      row.append(toggle, actions);
      li.append(row);
      if (open) li.append(renderNode(dir, depth + 1, expandAll));
      ul.append(li);
    }
    for (const f of [...node.files].sort((a, b) => byName(a.path, b.path))) {
      const li = document.createElement("li");
      // A div, not a <button>: Firefox (and sometimes Safari) will not start a drag on buttons.
      const b = document.createElement("div");
      b.setAttribute("role", "button");
      b.tabIndex = 0;
      b.className = "nb-note";
      b.textContent = baseOf(f.path).replace(/\.md$/i, "");
      b.title = f.path;
      b.style.setProperty("--depth", depth);
      b.dataset.dropDir = node.path;
      if (state.current && state.current.path === f.path) b.setAttribute("aria-current", "true");
      if (readDraft(f.path)) b.classList.add("has-draft");
      b.addEventListener("click", () => openNote(f.path));
      b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNote(f.path); } });
      b.addEventListener("pointerdown", (e) => beginPress(e, f.path, b));
      li.append(b);
      ul.append(li);
    }
    return ul;
  }

  /* drop targets: a folder row (or a note inside it) moves the note there; empty space means top level */
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
    if (dir === "") { el.tree.classList.add("is-drop"); if (drag.zone) drag.zone.classList.add("is-drop"); return; }
    const row = [...el.tree.querySelectorAll(".nb-folder")].find((r) => r.dataset.dropDir === dir);
    if (row) row.classList.add("is-drop");
    // Hovering over a collapsed folder opens it so you can drop deeper.
    if (collapsed.has(dir)) hoverTimer = setTimeout(() => { collapsed.delete(dir); saveCollapsed(); renderTree(); hoverDir = null; }, 700);
  }

  /* Pointer-based dragging (no HTML5 drag & drop, which is unreliable across browsers):
     mouse/pen start after a few pixels of movement, touch after a long press. */
  const drag = { path: null, el: null, x0: 0, y0: 0, active: false, ghost: null, timer: null, pointerId: null, type: "" };

  function beginPress(e, path, node) {
    if (e.button !== 0 || drag.path) return;
    Object.assign(drag, { path, el: node, x0: e.clientX, y0: e.clientY, active: false, pointerId: e.pointerId, type: e.pointerType });
    if (e.pointerType === "touch") drag.timer = setTimeout(() => startDrag(e.clientX, e.clientY), 420);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", cancelDrag);
  }

  function startDrag(x, y) {
    drag.active = true;
    dragPath = drag.path;
    drag.el.classList.add("is-dragging");
    el.tree.classList.add("is-dragging");
    document.body.classList.add("nb-dragging");
    const ghost = document.createElement("div");
    ghost.className = "nb-ghost";
    ghost.textContent = baseOf(drag.path).replace(/\.md$/i, "");
    document.body.append(ghost);
    drag.ghost = ghost;
    // Always-visible target for moving to the top level, even when the list is full.
    const zone = document.createElement("div");
    zone.className = "nb-rootzone";
    zone.dataset.dropDir = "";
    zone.textContent = "Drop here to move to top level";
    el.tree.append(zone);
    drag.zone = zone;
    moveGhost(x, y);
    if (navigator.vibrate && drag.type === "touch") navigator.vibrate(15);
  }

  function moveGhost(x, y) {
    if (drag.ghost) drag.ghost.style.transform = "translate(" + (x + 12) + "px," + (y + 10) + "px)";
  }

  function onPointerMove(e) {
    if (e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      if (drag.type === "touch") { if (moved > 10) cancelDrag(); return; } // finger moved first: it's a scroll
      if (moved < 6) return;
      startDrag(e.clientX, e.clientY);
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const dir = target && el.tree.contains(target) ? (dropDirFor(target) ?? "") : null;
    if (dir == null || dir === dirOf(drag.path)) clearDropHighlight();
    else highlightDrop(dir);
    // Auto-scroll the list near its edges.
    const r = el.tree.getBoundingClientRect();
    if (e.clientY < r.top + 28) el.tree.scrollTop -= 12;
    else if (e.clientY > r.bottom - 28) el.tree.scrollTop += 12;
  }

  function onPointerUp(e) {
    if (e.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    const from = drag.path;
    const dir = hoverDir;
    cancelDrag();
    if (!wasActive) return; // plain click: handled by the click listener
    suppressClick();
    if (dir == null || dir === dirOf(from)) return;
    moveNote(from, (dir ? dir + "/" : "") + baseOf(from));
  }

  function cancelDrag() {
    clearTimeout(drag.timer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", cancelDrag);
    if (drag.el) drag.el.classList.remove("is-dragging");
    if (drag.ghost) drag.ghost.remove();
    if (drag.zone) drag.zone.remove();
    el.tree.classList.remove("is-dragging");
    document.body.classList.remove("nb-dragging");
    clearDropHighlight();
    Object.assign(drag, { path: null, el: null, active: false, ghost: null, zone: null, timer: null, pointerId: null });
    dragPath = null;
  }

  // The click that follows a drag must not open the note.
  function suppressClick() {
    const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
    window.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
  }

  // While dragging with a finger, stop the page from scrolling; Esc cancels a drag.
  el.tree.addEventListener("touchmove", (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
  el.tree.addEventListener("contextmenu", (e) => { if (drag.path) e.preventDefault(); });
  window.addEventListener("keydown", (e) => { if (e.key === "Escape" && drag.path) cancelDrag(); });

  async function loadTree() {
    const data = await api("GET", "/api/tree");
    state.files = data.files;
    state.folders = data.folders || [];
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

  async function createFolder(parent) {
    const name = prompt(parent ? 'New folder inside "' + parent + '":' : "New folder name (use a/b for nested folders):", "");
    if (name == null) return;
    const rel = name.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
    if (!rel) return;
    const path = parent ? parent + "/" + rel : rel;
    if (state.folders.some((d) => d.path === path)) { alert('Folder "' + path + '" already exists.'); return; }
    try {
      setStatus("Creating folder…", "busy");
      await api("POST", "/api/folder", { path });
      for (let d = path; d; d = dirOf(d)) collapsed.delete(d);
      saveCollapsed();
      await loadTree();
      setStatus("Folder created", "ok");
    } catch (e) {
      setStatus("Create folder failed: " + e.message, "error");
    }
  }
  el.newFolderBtn.addEventListener("click", () => createFolder(""));

  async function deleteFolder(dir) {
    if (!confirm('Delete empty folder "' + dir.path + '"?')) return;
    try {
      setStatus("Deleting folder…", "busy");
      await api("DELETE", "/api/folder", { path: dir.path, sha: dir.keep });
      collapsed.delete(dir.path);
      saveCollapsed();
      await loadTree();
      setStatus("Folder deleted", "ok");
    } catch (e) {
      setStatus("Delete folder failed: " + e.message, "error");
    }
  }

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
