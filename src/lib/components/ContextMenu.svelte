<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { keyLabel } from '../shortcuts';
  import { store, type MenuItem } from '../store.svelte';

  /**
   * The one context menu of the app: opened with the right button or the menu
   * key, moved through with the arrows, and closed giving the focus back.
   */
  let { x, y, items }: { x: number; y: number; items: MenuItem[] } = $props();

  let el = $state<HTMLDivElement>();
  let left = $state(0);
  let top = $state(0);
  const opener = document.activeElement as HTMLElement | null;

  const buttons = () => [...(el?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];

  function close(refocus = true) {
    store.menu = null;
    if (refocus) opener?.focus?.();
  }

  function run(item: MenuItem) {
    close(false);
    item.run();
  }

  function onKey(e: KeyboardEvent) {
    const all = buttons();
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => all[(to + all.length) % all.length]?.focus();
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at < 0 ? -1 : at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(-1);
    else if (e.key === 'Escape' || e.key === 'Tab') close();
    else {
      // A letter goes to the next item that starts with it.
      if (e.key.length !== 1) return;
      const letter = e.key.toLowerCase();
      const next = [...all.slice(at + 1), ...all.slice(0, at + 1)].find((b) => b.textContent?.trim().toLowerCase().startsWith(letter));
      if (!next) return;
      next.focus();
    }
    e.preventDefault();
    e.stopPropagation();
  }

  onMount(async () => {
    await tick();
    if (!el) return;
    // Kept inside the window, opening upwards or leftwards near its edges.
    const box = el.getBoundingClientRect();
    left = Math.max(4, Math.min(x, innerWidth - box.width - 4));
    top = Math.max(4, Math.min(y, innerHeight - box.height - 4));
    buttons()[0]?.focus();
  });
</script>

<svelte:window onpointerdown={(e) => { if (!el?.contains(e.target as Node)) close(false); }} onblur={() => close(false)} onresize={() => close(false)} />

<!-- svelte-ignore a11y_interactive_supports_focus -->
<div class="menu" role="menu" bind:this={el} style:left="{left}px" style:top="{top}px" onkeydown={onKey} oncontextmenu={(e) => e.preventDefault()}>
  {#each items as item, i (i)}
    {#if item.separator && i > 0}<div class="sep" role="separator"></div>{/if}
    <button role="menuitem" class:danger={item.danger} disabled={item.disabled} onclick={() => run(item)}>
      <span class="ico">{#if item.icon}<Icon name={item.icon} size={14} />{/if}</span>
      <span class="label">{item.label}</span>
      {#if item.keys}<span class="keys">{#each item.keys as k}<kbd>{keyLabel(k)}</kbd>{/each}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .menu { position: fixed; z-index: var(--z-menu); min-width: 210px; max-width: 320px; padding: var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--raised); box-shadow: var(--shadow-lg); }
  button { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-1-5) var(--space-2); border: 0; border-radius: var(--radius-sm); background: none; color: var(--text); font-size: var(--font-md); text-align: left; }
  button:hover:not(:disabled), button:focus-visible { background: var(--hover); outline: none; }
  button:disabled { color: var(--text-3); }
  .ico { display: flex; flex: none; width: 14px; color: var(--text-3); }
  .label { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .keys { display: flex; flex: none; gap: var(--space-0-5); }
  kbd { padding: 0 var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-xs); background: var(--bg); color: var(--text-3); font: var(--font-xs)/1.6 var(--sans); }
  .danger { color: var(--danger); }
  .danger .ico { color: var(--danger); }
  .sep { height: 1px; margin: var(--space-1) var(--space-1-5); background: var(--line); }
</style>
