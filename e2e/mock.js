// Stands in for the Rust backend with an in-memory vault, so interface tests
// run in any browser. The backend has its own tests in crates/.
(() => {
  const files = {
    a: {
      'Inicio.md': '# Inicio\n\nVer [[Destino]] y [[Falta]].\n\n<script>window.pwned = true</script><img src=x onerror="window.pwned=true"><b style="color:red">fuerte</b>\n\n```mermaid\nflowchart LR\n  A --> B\n```\n',
      'dir/Destino.md': '# Destino\n',
    },
    b: { 'Otra.md': '# Otra\n' },
  };
  const vaults = [
    { id: 'a', name: 'Trabajo', path: '/v/Trabajo', open: true, mcp: 'read', allowScripts: false },
    { id: 'b', name: 'Personal', path: '/v/Personal', open: true, mcp: 'off', allowScripts: false },
  ];
  const versions = {};
  const versionOf = (id, path) => (versions[`${id}:${path}`] ??= 'v0');
  const bump = (id, path) => (versions[`${id}:${path}`] = `v${Date.now()}${Math.random()}`);
  let listener = null;

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
    'plugin:event|listen': ({ handler }) => {
      listener = handler;
      return 1;
    },
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
    /** Simulates another program, such as the MCP server, changing a file. */
    externalWrite(id, path, content) {
      files[id][path] = content;
      bump(id, path);
      window[`_${listener}`]?.({ payload: { vaultId: id, paths: [path] } });
    },
  };
})();
