<script lang="ts">
  import { LANGUAGES, language, setLanguage, tr, type Key, type Language } from '../i18n.svelte';
  import { store } from '../store.svelte';

  const DIAGRAM_SAMPLE = '```mermaid\nflowchart LR\n  A[Idea] --> B[Nota]\n```';
  const STEPS: { title: Key; body: Key; sample?: string }[] = [
    { title: 'tutorial.welcomeTitle', body: 'tutorial.welcomeBody' },
    { title: 'tutorial.vaultsTitle', body: 'tutorial.vaultsBody' },
    { title: 'tutorial.writeTitle', body: 'tutorial.writeBody' },
    { title: 'tutorial.diagramsTitle', body: 'tutorial.diagramsBody', sample: DIAGRAM_SAMPLE },
    { title: 'tutorial.searchTitle', body: 'tutorial.searchBody' },
    { title: 'tutorial.exportTitle', body: 'tutorial.exportBody' },
    { title: 'tutorial.themesTitle', body: 'tutorial.themesBody' },
    { title: 'tutorial.mcpTitle', body: 'tutorial.mcpBody' },
  ];

  let index = $state(0);
  const step = $derived(STEPS[index]);
  const last = $derived(index === STEPS.length - 1);

  function next() {
    if (last) store.closeTutorial();
    else index++;
  }

  const focus = (el: HTMLElement) => el.focus();
</script>

<div class="scrim shade"></div>
<div class="tutorial" role="dialog" aria-modal="true" aria-label={tr('tutorial.label')}>
  <p class="count">{tr('tutorial.step', { n: index + 1, total: STEPS.length })}</p>
  <h2>{tr(step.title)}</h2>
  <p class="body">{tr(step.body)}</p>
  {#if step.sample}<pre>{step.sample}</pre>{/if}
  {#if index === 0}
    <label class="language">{tr('settings.language')}
    <select value={language()} onchange={(e) => setLanguage(e.currentTarget.value as Language)}>
      {#each LANGUAGES as l (l.code)}<option value={l.code}>{l.name}</option>{/each}
    </select>
  </label>
  {/if}
  <div class="dots" aria-hidden="true">
    {#each STEPS as _, i}<span class:on={i === index}></span>{/each}
  </div>
  <footer>
    <button onclick={() => store.closeTutorial()}>{tr('tutorial.skip')}</button>
    <span class="spacer"></span>
    {#if index > 0}<button onclick={() => index--}>{tr('tutorial.back')}</button>{/if}
    <button class="main" use:focus onclick={next}>{tr(last ? 'tutorial.finish' : 'tutorial.next')}</button>
  </footer>
</div>

<style>
  .shade { position: fixed; inset: 0; z-index: 70; }
  .tutorial { position: fixed; top: 50%; left: 50%; z-index: 71; display: flex; flex-direction: column; width: min(520px, calc(100vw - 32px)); min-height: 340px; max-height: calc(100vh - 32px); padding: 22px 24px 18px; overflow-y: auto; border: 1px solid var(--line); border-radius: 12px; background: var(--raised); box-shadow: var(--shadow); transform: translate(-50%, -50%); }
  .count { margin: 0 0 6px; color: var(--text-3); font-size: 12px; }
  h2 { margin: 0 0 10px; font-size: 19px; font-weight: 650; letter-spacing: -.01em; }
  .body { margin: 0; color: var(--text-2); font-size: 14px; line-height: 1.55; }
  pre { margin: 14px 0 0; padding: 10px 12px; overflow-x: auto; border-radius: 8px; background: var(--panel); font: 12.5px/1.5 var(--mono); }
  .language { display: flex; align-items: center; gap: 10px; margin-top: 16px; color: var(--text-2); font-size: 13px; }
  select { min-width: 170px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
  .dots { display: flex; gap: 6px; justify-content: center; margin-top: auto; padding-top: 18px; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
  .dots .on { background: var(--accent); }
  footer { display: flex; gap: 8px; margin-top: 14px; }
  footer button { padding: 6px 12px; border: 1px solid var(--line); border-radius: 7px; background: none; color: var(--text); font-size: 13px; }
  footer .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .spacer { flex: 1; }
</style>
