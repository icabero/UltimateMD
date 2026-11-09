<script lang="ts">
  /** Word's size when a template sets none, which the viewer does not assume. */
  const CSS = `
    :host { display: block; }
    .docx-wrapper { padding: 0 !important; background: none !important; }
    .docx-wrapper > section.docx { margin: 0 auto var(--space-3) !important; box-shadow: var(--shadow-md) !important; font-size: 10pt; }
  `;

  let host = $state<HTMLDivElement>();
  let shown = 0;

  /** Replaces what is on display; a newer call wins over one still drawing. */
  export async function show(bytes: number[]) {
    const id = ++shown;
    const { renderAsync } = await import('docx-preview');
    const body = document.createElement('div');
    const style = document.createElement('style');
    style.textContent = CSS;
    await renderAsync(new Uint8Array(bytes), body, body, { inWrapper: true, breakPages: true, useBase64URL: true });
    if (id !== shown || !host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.replaceChildren(style, body);
    // The sheets keep their real size; the zoom only fits them to the panel.
    const sheet = body.querySelector('section');
    if (sheet?.offsetWidth) body.style.zoom = String(host.clientWidth / sheet.offsetWidth);
  }

  /** A copy of the first page with its styles, at its real size, for a thumbnail. */
  export function firstPage(): Node[] {
    const root = host?.shadowRoot;
    const body = root?.lastElementChild as HTMLElement | null;
    if (!root || !body) return [];
    const copy = body.cloneNode(true) as HTMLElement;
    copy.style.zoom = '';
    copy.querySelectorAll('section.docx').forEach((page, i) => i > 0 && page.remove());
    const style = document.createElement('style');
    style.textContent = `${CSS} .docx-wrapper > section.docx { margin: 0 !important; box-shadow: none !important; }`;
    return [style, copy];
  }
</script>

<div class="sheet" bind:this={host}></div>

<style>
  .sheet { width: 100%; }
</style>
