<script lang="ts">
  // Chooses what makes a folder or a note stand out: a colour of the theme and an emoji.
  import { untrack } from 'svelte';
  import { dim, pop } from '../motion';
  import { tr } from '../i18n.svelte';
  import { fileUrl } from '../api';
  import { EMOJIS, FOLDER_COLORS, validEmoji } from '../look';
  import { kindOf } from '../paths';
  import { store, type Picker } from '../store.svelte';

  let { picker }: { picker: Picker } = $props();

  let color = $state<string | null>(untrack(() => picker.color));
  let emoji = $state(untrack(() => picker.emoji ?? ''));
  const withColor = $derived(picker.kind === 'look');
  const typed = $derived(emoji.trim());
  const valid = $derived(!typed || validEmoji(typed));
  const empty = $derived(!color && !typed);
  const images = $derived(picker.kind === 'image');
  let query = $state('');
  /** The vault's images that match what is typed, the first few hundred. */
  const found = $derived(
    images
      ? store.files(picker.vaultId).filter((f) => kindOf(f) === 'image' && f.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200)
      : [],
  );

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (valid && !images) picker.resolve({ color, emoji: typed || null, image: null });
  }

  const focus = (el: HTMLElement) => el.focus();
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') store.picker?.resolve(null); }} />

<button in:dim class="scrim top" aria-label={tr('common.cancel')} onclick={() => picker.resolve(null)}></button>
<form in:pop class="dialog" aria-label={picker.title} {onsubmit}>
  <p class="title">{picker.title}</p>
  {#if images}
    <input class="query" bind:value={query} use:focus placeholder={tr('look.findImage')} aria-label={tr('look.findImage')} />
    <div class="images" role="listbox" aria-label={tr('look.coverTitle')}>
      {#each found as path (path)}
        <button type="button" class="image" role="option" aria-selected="false" title={path} onclick={() => picker.resolve({ color: null, emoji: null, image: path })}>
          <img src={fileUrl(picker.vaultId, path)} alt="" loading="lazy" />
          <span>{path.split('/').pop()}</span>
        </button>
      {:else}
        <p class="hint none">{tr('look.noImages')}</p>
      {/each}
    </div>
    <p class="hint">{tr('look.coverHint')}</p>
    <div class="buttons">
      <span class="grow"></span>
      <button type="button" onclick={() => picker.resolve(null)}>{tr('common.cancel')}</button>
    </div>
  {:else}
  {#if withColor}
    <div class="colors" role="radiogroup" aria-label={tr('look.colors')}>
      <button type="button" class="swatch none" role="radio" aria-checked={!color} aria-label={tr('look.noColor')} title={tr('look.noColor')} onclick={() => (color = null)}></button>
      {#each Object.entries(FOLDER_COLORS) as [id, value], i (id)}
        <button type="button" class="swatch" role="radio" aria-checked={color === id} aria-label={tr('look.color', { n: i + 1 })} style:--swatch={value} onclick={() => (color = id)}></button>
      {/each}
    </div>
  {/if}
  <div class="emojis" role="group" aria-label={tr('look.emojis')}>
    {#each EMOJIS as e (e)}
      <button type="button" class="emoji" class:on={typed === e} aria-pressed={typed === e} onclick={() => (emoji = e)}>{e}</button>
    {/each}
  </div>
  <label class="free">
    <span>{tr('look.typeOne')}</span>
    <input bind:value={emoji} use:focus aria-invalid={!valid} maxlength="24" placeholder="🙂" />
  </label>
  <p class="hint">{tr(withColor ? 'look.folderHint' : 'look.iconHint')}</p>
  <div class="buttons">
    <button type="button" class="remove" disabled={empty && !picker.color && !picker.emoji} onclick={() => picker.resolve({ color: null, emoji: null, image: null })}>{tr('look.remove')}</button>
    <span class="grow"></span>
    <button type="button" onclick={() => picker.resolve(null)}>{tr('common.cancel')}</button>
    <button type="submit" class="main" disabled={!valid}>{tr('common.accept')}</button>
  </div>
  {/if}
</form>

<style>
  .top { z-index: var(--z-confirm-scrim); }
  .dialog { position: fixed; top: 18vh; left: 50%; z-index: var(--z-confirm); display: flex; flex-direction: column; gap: var(--space-3); width: min(380px, calc(100vw - 32px)); padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--raised); box-shadow: var(--shadow-lg); transform: translateX(-50%); }
  .title { margin: 0; font-size: var(--font-md); font-weight: 600; }
  .colors { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .swatch { width: 24px; height: 24px; padding: 0; border: 2px solid transparent; border-radius: 50%; background: var(--swatch); }
  .swatch.none { border: 1.5px dashed var(--text-3); background: none; }
  .swatch[aria-checked='true'] { outline: 2px solid var(--text); outline-offset: 2px; }
  .images { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); max-height: 280px; overflow-y: auto; }
  .image { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; padding: var(--space-1); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text-2); font-size: var(--font-xs); }
  .image:hover, .image:focus-visible { background: var(--hover); }
  .image img { width: 100%; height: 56px; border-radius: var(--radius-sm); object-fit: cover; }
  .image span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { grid-column: 1 / -1; }
  .emojis { display: grid; grid-template-columns: repeat(8, 1fr); gap: var(--space-0-5); }
  .emoji { height: 34px; padding: 0; border: 0; border-radius: var(--radius-sm); background: none; font-size: var(--font-lg); }
  .emoji:hover { background: var(--hover); }
  .emoji.on { background: var(--accent-soft); outline: 1.5px solid var(--accent); }
  .free { display: flex; align-items: center; gap: var(--space-2); color: var(--text-2); font-size: var(--font-sm); }
  .free input { flex: 1; min-width: 0; height: 30px; }
  [aria-invalid='true'] { border-color: var(--danger); }
  .hint { margin: 0; color: var(--text-3); font-size: var(--font-xs); line-height: 1.4; }
  .buttons { display: flex; align-items: center; gap: var(--space-2); }
  .grow { flex: 1; }
  .buttons button { padding: var(--space-1-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); font-size: var(--font-md); }
  .buttons button:disabled { opacity: .5; }
  .remove { border-color: transparent; color: var(--danger); }
  .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
</style>
