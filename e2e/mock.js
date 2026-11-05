// Stands in for the Rust backend with an in-memory vault, so interface tests
// run in any browser. The backend has its own tests in crates/.
(() => {
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
      themes: [{ id: 'mar', name: 'Mar', base: 'claro', colors: { bg: '#e0f0ff' }, diagram: {} }],
      invalid: [],
    },
  };
  const versionOf = (id, path) => (versions[`${id}:${path}`] ??= 'v0');
  const bump = (id, path) => (versions[`${id}:${path}`] = `v${Date.now()}${Math.random()}`);
  const listeners = {};

  function tree(id) {
    const root = [];
    for (const path of Object.keys(files[id]).sort()) {
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
    set_vault_access: ({ id, mcp }) => {
      vaults.find((v) => v.id === id).mcp = mcp;
    },
    mcp_info: () => ({ binary: 'C:\\Program Files\\UltimateMD\\ultimatemd-mcp.exe', available: true }),
    search_all: ({ query }) =>
      Object.entries(files).flatMap(([vaultId, notes]) =>
        Object.entries(notes)
          .filter(([, text]) => text.includes(query))
          .map(([path]) => ({ vaultId, hit: { path, line: 1, text: query } })),
      ),
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
    vault_themes: ({ id }) => vaultThemes[id] ?? { defaultTheme: null, themes: [], invalid: [] },
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
    list_templates: () => ['Ejemplo', 'Corporativa'],
    export_file: ({ name, data }) => {
      window.__exported = { name, text: new TextDecoder().decode(new Uint8Array(data)) };
      return true;
    },
    export_docx: ({ plan }) => {
      window.__docx = plan;
      return true;
    },
    export_pdf: ({ plan }) => {
      window.__pdf = plan;
      return true;
    },
    preview_pdf: () => ['data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'],
    preview_docx: () => ({
      width: 595, height: 842, top: 72, right: 72, bottom: 72, left: 72, header: '<p>Cabecera</p>',
      footer: '<p><span class="page-number"></span></p>', titlePage: false,
      blocks: [{ html: '<p>Bloque uno</p>', breakBefore: false }, { html: '<p>Bloque dos</p>', breakBefore: true }],
    }),
    template_styles: () => [{ id: 'Destacado', name: 'Destacado' }, { id: 'Heading1', name: 'heading 1' }],
    take_pending_files: () => window.__pending ?? [],
    default_app_info: () => ({ platform: 'windows', appimage: false, isDefault: false }),
  };

  window.__TAURI_INTERNALS__ = {
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
    vaultThemes,
    /** Simulates another program, such as the MCP server, changing a file. */
    externalWrite(id, path, content) {
      files[id][path] = content;
      bump(id, path);
      window[`_${listeners['vault-changed']}`]?.({ payload: { vaultId: id, paths: [path] } });
    },
    /** Simulates the operating system opening files in the running app. */
    openFiles(paths) {
      window[`_${listeners['open-files']}`]?.({ payload: paths });
    },
  };
})();
