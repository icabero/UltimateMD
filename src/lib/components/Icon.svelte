<script lang="ts">
  const PATHS: Record<string, string> = {
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    chevron: 'M9 6l6 6-6 6',
    file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
    folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
    code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.3-4.3',
    settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
    edit: 'M4 20l1-4L16 5l3 3L8 19zM14 7l3 3',
    split: 'M4 5h16v14H4zM12 5v14',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    export: 'M12 15V4M8 8l4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
    visual: 'M6 5h12M12 5v14M9 19h6',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    numbers: 'M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M4 15.5a1.5 1.5 0 1 1 2.6 1L4 20h3',
    tasks: 'M4 5h5v5H4zM4 14h5v5H4zM13 7h7M13 17h7M5.5 16.5l1 1 2-2',
    quote: 'M9 7H5v6h4zM9 13c0 2-1 3-3 4M19 7h-4v6h4zM19 13c0 2-1 3-3 4',
    table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    rule: 'M4 12h16',
    word: 'M4 6l4 12 4-9 4 9 4-12',
    branch: 'M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5 1-2 2-2H18a3 3 0 0 0 3-3c0-4.5-4-8.5-9-8.5zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
    diagram: 'M9 4h6v5H9zM3 15h6v5H3zM15 15h6v5h-6zM12 9v3M6 15v-3h12v3',
    minimize: 'M6 12h12',
    maximize: 'M6 6h12v12H6z',
    restore: 'M9 9h10v10H9zM6 15V6a1 1 0 0 1 1-1h8',
    panelLeft: 'M4 5h16v14H4zM9 5v14',
    panelRight: 'M4 5h16v14H4zM15 5v14',
    refresh: 'M20 11a8 8 0 0 0-14.9-4M4 13a8 8 0 0 0 14.9 4M5 3v4h4M19 21v-4h-4',
    pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v7',
    copy: 'M9 9h10v11H9zM5 15V4h10',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
    star: 'M12 4l2.5 5.2 5.5.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.5-.8z',
    keyboard: 'M3 7h18v10H3zM7 10h.01M11 10h.01M15 10h.01M8 14h8',
    link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  };
  let { name, size = 16 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={PATHS[name]} />
</svg>
