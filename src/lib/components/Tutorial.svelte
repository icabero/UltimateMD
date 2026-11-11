<script lang="ts">
  import { dim, pop } from '../motion';
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

<div in:dim class="scrim shade"></div>
<div in:pop class="tutorial" role="dialog" aria-modal="true" aria-label={tr('tutorial.label')}>
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
    {#if last}<button onclick={() => store.createSampleVault()}>{tr('sample.create')}</button>{/if}
    <button class="main" use:focus onclick={next}>{tr(last ? 'tutorial.finish' : 'tutorial.next')}</button>
  </footer>
</div>

<style>
  .shade { position: fixed; inset: 0; z-index: var(--z-tour-scrim); }
  .tutorial { position: fixed; top: 50%; left: 50%; z-index: var(--z-tour); display: flex; flex-direction: column; width: min(520px, calc(100vw - 32px)); min-height: 340px; max-height: calc(100vh - 32px); padding: var(--space-6) var(--space-6) var(--space-5); overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-xl); background: var(--raised); box-shadow: var(--shadow-lg); transform: translate(-50%, -50%); }
  .count { margin: 0 0 var(--space-1-5); color: var(--text-3); font-size: var(--font-sm); }
  h2 { margin: 0 0 var(--space-2-5); font-size: var(--font-xl); font-weight: 650; letter-spacing: -.01em; }
  .body { margin: 0; color: var(--text-2); font-size: var(--font-base); line-height: 1.55; }
  pre { margin: var(--space-3-5) 0 0; padding: var(--space-2-5) var(--space-3); overflow-x: auto; border-radius: var(--radius-md); background: var(--panel); font: var(--font-sm)/1.5 var(--mono); }
  .language { display: flex; align-items: center; gap: var(--space-2-5); margin-top: var(--space-4); color: var(--text-2); font-size: var(--font-md); }
  select { min-width: 170px; padding: var(--space-1-5) var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); font: inherit; }
  .dots { display: flex; gap: var(--space-1-5); justify-content: center; margin-top: auto; padding-top: var(--space-5); }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--line); }
  .dots .on { background: var(--accent); }
  footer { display: flex; gap: var(--space-2); margin-top: var(--space-3-5); }
  footer button { padding: var(--space-1-5) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md); background: none; color: var(--text); font-size: var(--font-md); }
  footer .main { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .spacer { flex: 1; }
</style>
