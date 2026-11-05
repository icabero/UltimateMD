<script lang="ts">
  import { store } from '../store.svelte';
  const keys = [['Ctrl P', 'Abrir nota'], ['Ctrl Mayús F', 'Buscar en todo'], ['Ctrl N', 'Nueva nota'], ['Ctrl \\', 'Cambiar vista']];
</script>

<div class="wrap">
  <h1>Ultimate<b>MD</b></h1>
  {#if store.openVaults.length === 0}
    <p>Crea un vault o abre una carpeta desde la barra lateral. Un vault es una carpeta normal con tus notas.</p>
  {:else}
    <dl>
      {#each keys as [key, label]}
        <div><dt>{key}</dt><dd>{label}</dd></div>
      {/each}
    </dl>
  {/if}
</div>

<style>
  .wrap { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 24px; background: var(--bg); text-align: center; }
  h1 { margin: 0 0 14px; color: var(--text-2); font-size: 26px; font-weight: 400; letter-spacing: -.02em; }
  b { color: var(--text); font-weight: 700; }
  p { max-width: 380px; color: var(--text-2); font-size: 14px; line-height: 1.5; }
  dl { display: grid; gap: 7px; margin: 8px 0 0; }
  div { display: flex; gap: 12px; align-items: center; font-size: 13px; }
  dt { min-width: 104px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--text-2); font: 11.5px var(--mono); }
  dd { margin: 0; color: var(--text-2); }
</style>
