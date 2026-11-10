// Stands in for the Rust backend with an in-memory vault, so interface tests
// run in any browser. The backend has its own tests in crates/.
(() => {
  // Most tests are not about the first run. Tests that are set `fresh` first.
  if (!sessionStorage.getItem('fresh')) localStorage.setItem('ultimatemd.tutorial', '1');

  const files = {
    a: {
      'Inicio.md': '# Inicio\n\nVer [[Destino]] y [[Falta]].\n\n<script>window.pwned = true</script><img src=x onerror="window.pwned=true"><b style="color:red">fuerte</b>\n\n```mermaid\nflowchart LR\n  A --> B\n```\n',
      'dir/Destino.md': '# Destino\n',
      'dir/sub/Hondo.md': '# Hondo\n',
      'vacia/imagen.png': '',
      'D2.md': '```d2\nuno -> dos\n```\n\n```d2\nesto no vale -> {\n```\n\n```d2\ntres -> cuatro\n```\n',
    },
    b: {
      'Otra.md': '# Otra\n',
      'Propia.md': '---\ntema: sepia\n---\n# Propia\n',
      'Rara.md': '---\ntema: no-existe\n---\n# Rara\n',
    },
  };
  const vaults = [
    { id: 'a', name: 'Trabajo', path: '/v/Trabajo', open: true, mcp: 'read', allowScripts: false },
    { id: 'b', name: 'Personal', path: '/v/Personal', open: true, mcp: 'off', allowScripts: false },
  ];
  const versions = {};
  const vaultThemes = {
    b: {
      defaultTheme: 'mar',
      defaultDiagramTheme: null,
      themes: [{ id: 'mar', name: 'Mar', base: 'claro', colors: { bg: '#e0f0ff' }, diagram: {} }],
      invalid: [],
    },
  };
  const versionOf = (id, path) => (versions[`${id}:${path}`] ??= 'v0');
  // When each note last changed: invented hours ago at first, now on every write.
  const modified = {};
  const changedAt = (id, path) => (modified[`${id}:${path}`] ??= Date.now() - (Object.keys(modified).length + 1) * 3_600_000);
  const bump = (id, path) => {
    modified[`${id}:${path}`] = Date.now();
    return (versions[`${id}:${path}`] = `v${Date.now()}${Math.random()}`);
  };
  const listeners = {};
  const staged = {};
  const noteTemplates = { a: {}, b: {} };

  function tree(id) {
    const root = [];
    // Folders first, as the backend sorts them.
    const sortKey = (path) => path.split('/').map((part, i, all) => `${i < all.length - 1 ? 0 : 1}${part.toLowerCase()}`);
    const paths = Object.keys(files[id]).sort((a, b) => {
      const [x, y] = [sortKey(a), sortKey(b)];
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return x.length - y.length;
    });
    for (const path of paths) {
      const parts = path.split('/');
      let level = root;
      parts.forEach((name, i) => {
        const isDir = i < parts.length - 1;
        const full = parts.slice(0, i + 1).join('/');
        let node = level.find((n) => n.path === full);
        if (!node) level.push((node = { name, path: full, isDir, children: [] }));
        level = node.children;
      });
    }
    return root;
  }

  const past = { log: [], blobs: {}, versions: {} };
  function keepVersion(id, path, content, source, time = Date.now()) {
    const blob = `b${Object.keys(past.blobs).length}`;
    past.blobs[blob] = content;
    (past.versions[`${id}:${path}`] ??= []).push({ time, blob, source });
    return blob;
  }

  function replacePattern({ find, matchCase, wholeWord, regex }) {
    if (!find) throw 'nothing to find';
    let source = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) source = `\\b(?:${source})\\b`;
    try {
      return new RegExp(source, matchCase ? 'g' : 'gi');
    } catch (e) {
      throw `invalid regular expression: ${e}`;
    }
  }

  const commands = {
    list_vaults: () => vaults,
    vault_tree: ({ id }) => tree(id),
    read_note: ({ id, path }) => ({ path, content: files[id][path], version: versionOf(id, path) }),
    write_note: ({ id, path, content, expected }) => {
      if (expected && expected !== versionOf(id, path)) throw 'the file changed since it was read: ' + path;
      files[id][path] = content;
      return bump(id, path);
    },
    create_note: ({ id, path, content }) => {
      files[id][path] = content;
      return bump(id, path);
    },
    // Moves a note or folder and, like the backend, rewrites [[name]] links to a renamed note.
    rename_path: ({ id, from, to }) => {
      const notes = files[id];
      for (const path of Object.keys(notes)) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        notes[to + path.slice(from.length)] = notes[path];
        delete notes[path];
      }
      const stem = (p) => p.split('/').pop().replace(/\.md$/, '');
      const update = { links: 0, notes: [] };
      if (stem(from) === stem(to)) return update;
      for (const [path, text] of Object.entries(notes)) {
        const found = text.split(`[[${stem(from)}]]`).length - 1;
        if (!found) continue;
        notes[path] = text.replaceAll(`[[${stem(from)}]]`, `[[${stem(to)}]]`);
        bump(id, path);
        update.links += found;
        update.notes.push(path);
      }
      return update;
    },
    set_vault_access: ({ id, mcp }) => {
      vaults.find((v) => v.id === id).mcp = mcp;
    },
    mcp_info: () => ({ binary: 'C:\\Program Files\\UltimateMD\\ultimatemd-mcp.exe', available: true }),
    home_info: () => {
      const open = vaults.filter((v) => v.open);
      const stamps = (id) =>
        Object.keys(files[id])
          .filter((p) => p.endsWith('.md'))
          .map((path) => ({ path, modified: changedAt(id, path) }))
          .sort((a, b) => b.modified - a.modified);
      return {
        vaults: open.map((v) => {
          const s = stamps(v.id);
          return { vaultId: v.id, notes: s.length, lastEdit: s[0]?.modified ?? null, lastNote: s[0]?.path ?? null };
        }),
        recent: open
          .flatMap((v) => stamps(v.id).map((s) => ({ vaultId: v.id, ...s })))
          .sort((a, b) => b.modified - a.modified)
          .slice(0, 8),
      };
    },
    // Deletions wait aside until undone or finished, like the backend.
    trash_path: ({ id, path }) => {
      const token = `t${Object.keys(staged).length}`;
      const moved = {};
      for (const p of Object.keys(files[id])) {
        if (p !== path && !p.startsWith(`${path}/`)) continue;
        moved[p] = files[id][p];
        delete files[id][p];
      }
      staged[token] = moved;
      return token;
    },
    undo_trash: ({ id, token }) => {
      const moved = staged[token];
      if (Object.keys(moved).some((p) => p in files[id])) throw 'the path already exists';
      Object.assign(files[id], moved);
      delete staged[token];
      return Object.keys(moved)[0];
    },
    note_templates: ({ id }) => Object.keys(noteTemplates[id]).sort(),
    note_template: ({ id, name }) => {
      if (!(name in noteTemplates[id])) throw `not found: ${name}`;
      return noteTemplates[id][name];
    },
    save_note_template: ({ id, name, content }) => void (noteTemplates[id][name] = content),
    delete_note_template: ({ id, name }) => void delete noteTemplates[id][name],
    // Like the backend: a free name, numbered if taken.
    save_image: ({ id, dir, name }) => {
      const [stem, ext] = [name.replace(/\.[^.]+$/, ''), name.split('.').pop()];
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? name : `${stem}-${n}.${ext}`;
        const path = dir ? `${dir}/${candidate}` : candidate;
        if (!(path in files[id])) {
          files[id][path] = '';
          return path;
        }
      }
    },
    finish_trash: ({ token }) => {
      window.__trashed = [...(window.__trashed ?? []), ...Object.keys(staged[token])];
      delete staged[token];
    },
    // Like the backend, for [[wikilinks]] by name.
    // Wikilinks only, and a suggestion by a close enough name.
    broken_links: ({ id }) => {
      const stem = (p) => p.split('/').pop().replace(/\.md$/, '');
      const notes = Object.keys(files[id]).filter((p) => p.endsWith('.md'));
      const near = (a, b) => {
        const row = [...Array(b.length + 1).keys()];
        for (let i = 1; i <= a.length; i++) {
          let prev = row[0];
          row[0] = i;
          for (let j = 1; j <= b.length; j++) {
            const next = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j - 1], row[j]);
            prev = row[j];
            row[j] = next;
          }
        }
        return row[b.length] <= Math.max(1, Math.floor(a.length / 3));
      };
      return notes.flatMap((note) =>
        files[id][note].split('\n').flatMap((text, i) =>
          [...text.matchAll(/\[\[([^\]|#]+)/g)]
            .map((m) => m[1].trim())
            .filter((t) => !notes.some((n) => stem(n).toLowerCase() === t.replace(/\.md$/, '').toLowerCase()))
            .filter((t) => /\.md$|^[^.]*$/.test(t) || !Object.keys(files[id]).some((p) => p.split('/').pop() === t))
            .map((target) => {
              const toNote = /\.md$|^[^.]*$/.test(target);
              return { note, target, line: i + 1, toNote, suggestion: toNote ? (notes.find((n) => near(target.toLowerCase(), stem(n).toLowerCase())) ?? null) : null };
            }),
        ),
      );
    },
    repoint_link: ({ id, note, target, to }) => {
      const name = to.split('/').pop().replace(/\.md$/, '');
      const before = files[id][note];
      files[id][note] = before.split(`[[${target}`).join(`[[${name}`);
      bump(id, note);
      return before === files[id][note] ? 0 : 1;
    },
    note_links: ({ id, path }) => {
      const stem = (p) => p.split('/').pop().replace(/\.md$/, '');
      const targets = (text) => [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
      const find = (name) => Object.keys(files[id]).find((p) => stem(p).toLowerCase() === name.toLowerCase());
      const mine = targets(files[id][path] ?? '');
      return {
        outgoing: [...new Set(mine.map(find).filter(Boolean))],
        unresolved: [...new Set(mine.filter((t) => !find(t)))],
        backlinks: Object.keys(files[id]).filter((p) => p !== path && targets(files[id][p]).some((t) => find(t) === path)),
      };
    },
    // Like the backend: every word, ignoring case and accents, one hit per line.
    search_all: ({ query }) => {
      const fold = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      if (query.includes('/(')) throw 'invalid regular expression: unclosed group';
      // Words and "phrases"; the rest of the syntax is the backend's, tested there.
      const words = (query.match(/"[^"]*"?|\S+/g) ?? [])
        .filter((w) => !w.startsWith('-') && !/^\w+:/.test(w))
        .map((w) => fold(w.replace(/^"|"$/g, '')))
        .filter(Boolean);
      const matches = (t) => words.every((w) => fold(t).includes(w));
      return Object.entries(files).flatMap(([vaultId, notes]) =>
        Object.entries(notes).flatMap(([path, text]) =>
          text.split('\n').flatMap((line, i) => (matches(line) ? [{ vaultId, hit: { path, line: i + 1, text: line.trim(), score: 1 } }] : [])),
        ),
      );
    },
    'plugin:event|listen': ({ event, handler }) => {
      listeners[event] = handler;
      return 1;
    },
    open_path: ({ path }) => {
      if (path === '/fuera/borrado.md') throw `not found: ${path}`;
      if (path.startsWith('/v/Trabajo/')) return { kind: 'vault', vaultId: 'a', path: path.slice('/v/Trabajo/'.length) };
      const name = path.split('/').pop();
      const id = `loose-${name}`;
      files[id] ??= { [name]: '# Suelto\n' };
      return { kind: 'loose', id, name, absolute: path, dir: path.slice(0, path.lastIndexOf('/')) };
    },
    close_loose: ({ id }) => {
      delete files[id];
    },
    open_vault: ({ path }) => {
      vaults.push({ id: 'c', name: 'fuera', path, open: true, mcp: 'read', allowScripts: false });
      files.c = { 'nota.md': '# Suelto\n' };
      return vaults.at(-1);
    },
    vault_themes: ({ id }) => vaultThemes[id] ?? { defaultTheme: null, defaultDiagramTheme: null, themes: [], invalid: [] },
    save_vault_theme: ({ id, theme }) => {
      vaultThemes[id] ??= { defaultTheme: null, themes: [], invalid: [] };
      vaultThemes[id].themes = vaultThemes[id].themes.filter((t) => t.id !== theme.id).concat(theme);
    },
    delete_vault_theme: ({ id, theme }) => {
      vaultThemes[id].themes = vaultThemes[id].themes.filter((t) => t.id !== theme);
    },
    set_vault_default_theme: ({ id, theme }) => {
      vaultThemes[id] ??= { defaultTheme: null, themes: [], invalid: [] };
      vaultThemes[id].defaultTheme = theme;
    },
    set_vault_diagram_theme: ({ id, theme }) => {
      vaultThemes[id] ??= { defaultTheme: null, defaultDiagramTheme: null, themes: [], invalid: [] };
      vaultThemes[id].defaultDiagramTheme = theme;
    },
    list_templates: () => ['Ejemplo', 'Corporativa'],
    export_file: ({ name, data }) => {
      window.__exported = { name, text: new TextDecoder().decode(new Uint8Array(data)) };
      return `/exportados/${name}`;
    },
    export_docx: ({ plan }) => {
      window.__docx = plan;
      return `/exportados/${plan.title}.docx`;
    },
    // A test can slow it down to see the progress.
    export_pdf: async ({ plan }) => {
      await new Promise((resolve) => setTimeout(resolve, window.__slowExport ?? 0));
      window.__pdf = plan;
      return `/exportados/${plan.title}.pdf`;
    },
    open_exported: ({ path }) => void (window.__openedExport = path),
    reveal_exported: ({ path }) => void (window.__revealedExport = path),
    preview_pdf: () => ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'],
    // A real file, because the viewer opens it.
    preview_docx: () => Array.from(atob('UEsDBAoAAAAIAIKIZV26d6ScywAAAFMBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbJWQvVLDQAyEX+XmWiYnQ0HB2E4BtEDBC2jOsn3D/c1JCeHtkRNIQUcp7Wq/HfX7U4rmSI1DyYO9dZ3dj/37VyU2qmQe7CpSHwDYr5SQXamUVZlLSyg6tgUq+g9cCO667h58yUJZdrJl2LF/ohkPUczzSdcXSqPI1jxejBtrsFhrDB5FdTjm6Q9l90Nwenn28Boq36jBwti/av0WJjJv2OQFk8bBZ2kTTMUfkiLcZvwXr8xz8HS939JqK56YQ15SdFclYci/PeD8tvEbUEsDBAoAAAAAAIKIZV0AAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAIAIKIZV3+xpu/lAAAAAUBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAMBuCrRD5A3DIwoKRdWFgrLhClblrRPOSE1+3JwEARA6N///osq/7hV3EjzksMGlrZQN+pgVZTapDnJWVRGyFrmEtJB8RsZ/Imy5go1M0U2ZtSR3aYjL0YR7hrmj3ypwFbU5xGDdyCOD8T/SPHaVosHaO9egrlx4GvRpUNOyoa7pFHHN+xrCxgp3DzYPcCUEsDBAoAAAAAAIKIZV0AAAAAAAAAAAAAAAAFAAAAd29yZC9QSwMECgAAAAgAgohlXVtze8aIAAAAugAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOQQ6DMAwEvxLlAZj20EMU4NKPBOICEokjJ5T2941ppV5mZY28th1eYVNP5LxS7PSlafXQ28N4mvaAsaiqYzZHp5dSkgHI04LB5YYSxuoexMGVOvIMB7FPTBPmvMY5bHBt2xsEt0YtlSP5t2QSsKD0998ZUh5V4h1HZ0GEkE+mk99l+D/WfwBQSwECFAAKAAAACACCiGVduneknMsAAABTAQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAAIKIZV0AAAAAAAAAAAAAAAAGAAAAAAAAAAAAEAAAAPwAAABfcmVscy9QSwECFAAKAAAACACCiGVd/sabv5QAAAAFAQAACwAAAAAAAAAAAAAAAAAgAQAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAACCiGVdAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAADdAQAAd29yZC9QSwECFAAKAAAACACCiGVdW3N7xogAAAC6AAAAEQAAAAAAAAAAAAAAAAAAAgAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAUABQAgAQAAtwIAAAAA'), (c) => c.charCodeAt(0)),
    template_styles: () => [{ id: 'Destacado', name: 'Destacado' }, { id: 'Heading1', name: 'heading 1' }],
    'plugin:app|version': () => window.__appVersion ?? '0.1.0',
    'plugin:opener|open_url': ({ url }) => {
      window.__opened = url;
    },
    word_config: () => ({
      settings: window.__word,
      hasTemplate: window.__wordTemplate ?? false,
      info: { headings: ['Propio1', 'Propio2', null, null, null, null], body: 'Cuerpo', headerFill: 'A1B2C3', styles: [{ id: 'Propio1', name: 'Propio 1' }, { id: 'Propio2', name: 'Propio 2' }, { id: 'Cuerpo', name: 'Cuerpo' }] },
    }),
    save_word_settings: ({ settings }) => {
      window.__word = settings;
    },
    choose_vault_template: () => {
      window.__wordTemplate = true;
      return true;
    },
    remove_vault_template: () => {
      window.__wordTemplate = false;
    },
    word_sample: ({ markdown }) => {
      window.__wordSample = (window.__wordSample ?? 0) + 1;
      window.__wordMarkdown = markdown;
      return [];
    },
    take_pending_files: () => window.__pending ?? [],
    installer_language: () => window.__installerLanguage ?? null,
    check_mcp: () =>
      window.__mcpCheck ?? { ok: true, version: '9.9.9', vaults: vaults.filter((v) => v.mcp !== 'off').map((v) => ({ name: v.name, access: v.mcp })), failed: null, error: null },
    // The same rules as crates/core/src/replace.rs, which has its own tests.
    replace_preview: ({ replace }) => {
      const pattern = replacePattern(replace);
      return Object.entries(files).flatMap(([vaultId, notes]) =>
        Object.entries(notes).flatMap(([path, text]) => {
          if (!/\.(md|html?)$/i.test(path)) return [];
          const changes = text.split('\n').flatMap((line, i) => {
            const after = line.replace(pattern, replace.regex ? replace.with : () => replace.with);
            return after !== line ? [{ line: i + 1, before: line, after }] : [];
          });
          return changes.length ? [{ vaultId, path, version: versionOf(vaultId, path), changes }] : [];
        }),
      );
    },
    replace_apply: ({ replace, notes }) => {
      const pattern = replacePattern(replace);
      const replaced = [];
      const skipped = [];
      for (const { vaultId, path, version, lines } of notes) {
        if (versionOf(vaultId, path) !== version) {
          skipped.push(path);
          continue;
        }
        const before = files[vaultId][path];
        let count = 0;
        files[vaultId][path] = before
          .split('\n')
          .map((line, i) => {
            if (!lines.includes(i + 1)) return line;
            const after = line.replace(pattern, replace.regex ? replace.with : () => replace.with);
            if (after !== line) count++;
            return after;
          })
          .join('\n');
        replaced.push({ vaultId, path, before, version: bump(vaultId, path), lines: count });
      }
      return { replaced, skipped };
    },
    // Only #tags in the text; the backend's rules have their own tests.
    vault_tags: ({ id }) => {
      const counts = new Map();
      for (const text of Object.values(files[id] ?? {})) {
        const found = new Set([...text.matchAll(/(?<![\p{L}\p{N}_&/#-])#([\p{L}_][\p{L}\p{N}_/-]*)/gu)].map((m) => m[1]));
        for (const tag of found) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return [...counts].map(([tag, notes]) => ({ tag, notes })).sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag));
    },
    // Versions of notes and the AI's log: the real ones are in crates/core/src/history.rs.
    ai_log: ({ id }) => past.log.filter((e) => e.vault === id),
    ai_wrote: ({ id, path, version }) => past.log.some((e) => e.vault === id && e.path === path && e.after === version),
    ai_undo: ({ id, entry }) => {
      const found = past.log.find((e) => e.id === entry);
      if (found.after !== versionOf(id, found.path)) throw 'the file changed since it was read: ' + found.path;
      files[id][found.path] = past.blobs[found.before];
      bump(id, found.path);
      found.undone = true;
    },
    history_list: ({ id, path }) => [...(past.versions[`${id}:${path}`] ?? [])].reverse(),
    history_read: ({ blob }) => past.blobs[blob],
    history_keep: ({ id, path, beforeRestore }) => {
      keepVersion(id, path, files[id][path], beforeRestore ? 'before-restore' : 'edit');
      return true;
    },
    log_error: ({ source, message }) => void (window.__log = [...(window.__log ?? []), `[error] ${source}: ${message}`]),
    read_log: () => (window.__log ?? []).join('\n'),
    reveal_log: () => {},
    'plugin:dialog|open': () => window.__picked ?? null,
    create_vault: ({ parent, name }) => {
      const vault = { id: `n${vaults.length}`, name, path: `${parent}/${name}`, open: true, mcp: 'off', allowScripts: false };
      vaults.push(vault);
      files[vault.id] = {};
      return vault;
    },
    reveal_path: ({ id, path }) => void (window.__revealed = `${id}:${path}`),
    update_supported: () => window.__selfUpdate ?? true,
    update_install: async () => {
      if (window.__updateFails) throw 'signature does not match';
      window[`_${listeners['update-progress']}`]?.({ payload: { done: 40, total: 100 } });
      await new Promise((resolve) => setTimeout(resolve, 300));
      window.__updated = true;
    },
    watch_problems: () => window.__watchProblems ?? [],
    set_spellcheck: ({ languages }) => void (window.__spellcheck = languages),
    default_app_info: () => ({ platform: 'windows', appimage: false, isDefault: false }),
  };

  window.__word = { headings: [null, null, null, null, null, null], body: null, headerFill: null, tableTextSize: null, codeTextSize: null, imageMaxWidth: null, plainCode: false };

  // The window, so that its buttons can be tested. Calls are recorded in order.
  window.__windowCalls = [];
  for (const name of ['show', 'minimize', 'toggle_maximize', 'close', 'set_decorations', 'set_title_bar_style']) {
    commands[`plugin:window|${name}`] = (args) => void window.__windowCalls.push({ name, value: args?.value });
  }
  commands['plugin:window|is_maximized'] = () => false;
  commands['plugin:webview|set_webview_zoom'] = ({ value }) => void (window.__zoom = value);

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    invoke: async (cmd, args) => {
      if (!commands[cmd]) throw `mock: no command ${cmd}`;
      return commands[cmd](args);
    },
    transformCallback(fn) {
      const id = Math.floor(Math.random() * 1e9);
      window[`_${id}`] = fn;
      return id;
    },
    unregisterCallback() {},
    convertFileSrc: (path, scheme) => `${scheme}://localhost/${encodeURIComponent(path)}`,
  };

  window.__test = {
    files,
    vaults,
    vaultThemes,
    /** Simulates another program, such as the MCP server, changing a file. */
    externalWrite(id, path, content) {
      files[id][path] = content;
      bump(id, path);
      window[`_${listeners['vault-changed']}`]?.({ payload: { vaultId: id, paths: [path] } });
    },
    keepVersion,
    /** Simulates the AI rewriting a note through the MCP server, which logs it. */
    aiWrite(id, path, content, tool = 'update_note') {
      const before = keepVersion(id, path, files[id][path], 'before-ai');
      files[id][path] = content;
      const after = bump(id, path);
      past.log.unshift({ id: `e${past.log.length}`, vault: id, time: Date.now(), tool, path, from: null, before, after, undone: false });
      window[`_${listeners['vault-changed']}`]?.({ payload: { vaultId: id, paths: [path] } });
    },
    /** Changes a file on disk without the app hearing of it. */
    silentWrite(id, path, content) {
      files[id][path] = content;
      bump(id, path);
    },
    /** Simulates a vault that the system does not let the app watch. */
    watchFailed(id, error) {
      window[`_${listeners['watch-failed']}`]?.({ payload: { vaultId: id, error } });
    },
    /** Simulates the operating system opening files in the running app. */
    openFiles(paths) {
      window[`_${listeners['open-files']}`]?.({ payload: paths });
    },
  };
})();
