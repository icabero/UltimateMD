// One declarative list of every setting the user can change, so the search in
// the settings can find it and open the place where it lives. To make a new
// setting findable: add a line here and put the same id as `data-setting` on
// its element. Vault and note settings need nothing else.
import type { Key } from './i18n.svelte';
import type { VaultSection } from './store.svelte';

export type AppSection = 'general' | 'appearance' | 'vaults' | 'ai';
export type NoteGroup = 'look' | 'props';

type Common = {
  /** Same value as the `data-setting` attribute on the element in the screen. */
  id: string;
  label: Key;
  hint?: Key;
  /** Synonyms in every language, never shown. Matching ignores case and accents. */
  keywords: string;
};

export type SettingEntry =
  | (Common & { scope: 'app'; section: AppSection })
  | (Common & { scope: 'vault'; section: VaultSection })
  | (Common & { scope: 'note'; group: NoteGroup });

export const APP_SECTION_LABEL: Record<AppSection, Key> = {
  general: 'settings.sectionGeneral',
  appearance: 'settings.appearance',
  vaults: 'settings.sectionVaults',
  ai: 'settings.sectionAi',
};
export const VAULT_SECTION_LABEL: Record<VaultSection, Key> = {
  general: 'vaultSettings.general',
  look: 'vaultSettings.look',
  diagrams: 'vaultSettings.diagrams',
  word: 'vaultSettings.word',
  daily: 'vaultSettings.daily',
  ai: 'vaultSettings.ai',
};
export const NOTE_GROUP_LABEL: Record<NoteGroup, Key> = { look: 'noteLook.title', props: 'find.noteProps' };

export const APP_SETTINGS: SettingEntry[] = [
  { id: 'app.language', scope: 'app', section: 'general', label: 'settings.language', hint: 'find.languageHint', keywords: 'idioma language hizkuntza lengua castellano espanol english euskera basque traduccion' },
  { id: 'app.spell', scope: 'app', section: 'general', label: 'spell.title', hint: 'spell.hint', keywords: 'ortografia corrector spell spelling checker zuzentzailea' },
  { id: 'app.typewriter', scope: 'app', section: 'general', label: 'typewriter.title', hint: 'typewriter.hint', keywords: 'maquina de escribir typewriter centrar centrado cursor linea concentracion enfoque focus escritura idazmakina erdian' },
  { id: 'app.diagramPeek', scope: 'app', section: 'general', label: 'peek.setting', hint: 'peek.settingHint', keywords: 'diagrama vista previa ventana escribir mermaid d2 diagram preview window typing live diagramak aurrebista' },
  { id: 'app.images', scope: 'app', section: 'general', label: 'images.title', hint: 'images.hint', keywords: 'imagenes pegar images paste attachments adjuntos irudiak carpeta folder' },
  { id: 'app.log', scope: 'app', section: 'general', label: 'log.title', hint: 'log.intro', keywords: 'registro errores log errors diagnostico bug erregistroa akatsak' },
  { id: 'app.tutorial', scope: 'app', section: 'general', label: 'settings.tutorial', keywords: 'tutorial ayuda guia help guide laguntza' },
  { id: 'app.defaultApp', scope: 'app', section: 'general', label: 'settings.defaultApp', keywords: 'abrir archivos md default open association asociar programa lehenetsia' },
  { id: 'app.theme', scope: 'app', section: 'appearance', label: 'find.theme', hint: 'find.themeHint', keywords: 'tema oscuro claro dark light theme colores colors noche night ilun argi gaia koloreak' },
  { id: 'app.followSystem', scope: 'app', section: 'appearance', label: 'settings.followSystem', hint: 'find.followHint', keywords: 'sistema oscuro claro dark light system automatico auto modo mode ilun' },
  { id: 'app.reading', scope: 'app', section: 'appearance', label: 'reading.title', hint: 'find.readingHint', keywords: 'texto tamano ancho linea interlineado text size width line spacing leading fuente font irakurketa letra' },
  { id: 'app.zoom', scope: 'app', section: 'appearance', label: 'find.zoom', hint: 'reading.zoomHint', keywords: 'zoom aumentar reducir ampliar escala magnify handitu' },
  { id: 'app.nativeFrame', scope: 'app', section: 'appearance', label: 'settings.nativeFrame', hint: 'settings.nativeFrameHint', keywords: 'barra titulo ventana title bar window frame native nativa leihoa' },
  { id: 'app.vaults', scope: 'app', section: 'vaults', label: 'settings.sectionVaults', hint: 'settings.vaultsIntro', keywords: 'vault carpetas folders notas notes boveda trabajo abrir cerrar quitar vaultak' },
  { id: 'app.mcp', scope: 'app', section: 'ai', label: 'settings.mcpTitle', hint: 'settings.mcpIntro', keywords: 'mcp ia ai claude cursor conectar connect inteligencia artificial intelligence' },
  { id: 'app.mcpCheck', scope: 'app', section: 'ai', label: 'mcpCheck.title', hint: 'mcpCheck.intro', keywords: 'mcp probar test check comprobar conexion connection ia ai' },
];

/** The settings of one vault; the screen that holds them is opened with the vault's id. */
export const VAULT_SETTINGS: SettingEntry[] = [
  { id: 'vault.name', scope: 'vault', section: 'general', label: 'vaultSettings.name', hint: 'vaultSettings.nameHint', keywords: 'nombre renombrar name rename izena' },
  { id: 'vault.folder', scope: 'vault', section: 'general', label: 'vaultSettings.folder', keywords: 'carpeta ruta disco path folder reveal mostrar karpeta' },
  { id: 'vault.order', scope: 'vault', section: 'general', label: 'vaultSettings.order', hint: 'vaultSettings.orderHint', keywords: 'orden ordenar sort order alfabetico fecha modificadas recientes sailkapena' },
  { id: 'vault.scripts', scope: 'vault', section: 'general', label: 'vaultSettings.safety', hint: 'settings.scriptsHint', keywords: 'scripts html seguridad safety security javascript segurtasuna' },
  { id: 'vault.list', scope: 'vault', section: 'general', label: 'vaultSettings.inList', hint: 'vaultSettings.openHint', keywords: 'abrir cerrar quitar eliminar open close remove delete barra lateral sidebar kendu' },
  { id: 'vault.look', scope: 'vault', section: 'look', label: 'vaultSettings.look', hint: 'find.vaultLookHint', keywords: 'tema temas colores oscuro claro dark light theme themes colors editor json itxura gaiak' },
  { id: 'vault.diagrams', scope: 'vault', section: 'diagrams', label: 'vaultSettings.diagrams', hint: 'find.vaultDiagramsHint', keywords: 'diagramas mermaid guia estilo ia diagrams guide style diagramak' },
  { id: 'vault.word', scope: 'vault', section: 'word', label: 'vaultSettings.word', hint: 'find.vaultWordHint', keywords: 'word docx exportar export documento estilos titulos tablas imagenes codigo styles headings tables' },
  { id: 'vault.word.template', scope: 'vault', section: 'word', label: 'export.template', hint: 'find.templateHint', keywords: 'plantilla template dotx docx word modelo txantiloia' },
  { id: 'vault.daily', scope: 'vault', section: 'daily', label: 'vaultSettings.daily', hint: 'daily.folderHint', keywords: 'diario diaria hoy today daily journal fecha date carpeta nombre plantilla egunkaria gaur' },
  { id: 'vault.ai', scope: 'vault', section: 'ai', label: 'vaultSettings.ai', hint: 'vaultSettings.aiIntro', keywords: 'ia ai mcp acceso access leer escribir read write claude permisos permissions sarbidea' },
  { id: 'vault.aiLog', scope: 'vault', section: 'ai', label: 'aiLog.open', hint: 'vaultSettings.aiLogHint', keywords: 'registro historial ia ai log history cambios changes mcp erregistroa' },
  { id: 'vault.connect', scope: 'vault', section: 'ai', label: 'vaultSettings.connect', hint: 'vaultSettings.connectHint', keywords: 'conectar mcp ia ai claude cursor connect konektatu' },
];

export const NOTE_SETTINGS: SettingEntry[] = [
  { id: 'note.titulo', scope: 'note', group: 'props', label: 'props.title', hint: 'props.titleHint', keywords: 'titulo title frontmatter propiedades properties izenburua' },
  { id: 'note.autor', scope: 'note', group: 'props', label: 'props.author', hint: 'props.authorHint', keywords: 'autor author frontmatter egilea' },
  { id: 'note.fecha', scope: 'note', group: 'props', label: 'props.date', hint: 'props.dateHint', keywords: 'fecha date hoy today frontmatter data' },
  { id: 'note.theme', scope: 'note', group: 'look', label: 'props.theme', hint: 'props.themeHint', keywords: 'tema oscuro claro dark light theme colores colors nota note gaia' },
  { id: 'note.diagramTheme', scope: 'note', group: 'look', label: 'props.diagramTheme', hint: 'props.diagramThemeHint', keywords: 'diagramas mermaid boceto sketch estilo colores diagrams style colors diagramak' },
  { id: 'note.others', scope: 'note', group: 'props', label: 'props.others', hint: 'props.othersHint', keywords: 'propiedades properties frontmatter yaml etiquetas tags campos fields' },
];

/** Lower case, without accents, so "Idioma", "idioma" and "ídiómá" are the same. */
export function fold(text: string) {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

export type Hit = { entry: SettingEntry; vaultId?: string; path: string };

type Scope = { vaults: { id: string; name: string }[]; hasNote: boolean };
type Translate = (key: Key, params?: Record<string, string | number>) => string;

/** Every setting that is reachable now, each with the place that holds it. */
export function reachable({ vaults, hasNote }: Scope, t: Translate): Hit[] {
  const out: Hit[] = [];
  for (const entry of APP_SETTINGS) {
    if (entry.scope === 'app') out.push({ entry, path: `${t('settings.title')} › ${t(APP_SECTION_LABEL[entry.section])}` });
  }
  for (const v of vaults) {
    for (const entry of VAULT_SETTINGS) {
      if (entry.scope === 'vault') out.push({ entry, vaultId: v.id, path: `${t('find.vaultPath', { name: v.name })} › ${t(VAULT_SECTION_LABEL[entry.section])}` });
    }
  }
  if (hasNote) {
    for (const entry of NOTE_SETTINGS) {
      if (entry.scope === 'note') out.push({ entry, path: `${t('panel.properties')} › ${t(NOTE_GROUP_LABEL[entry.group])}` });
    }
  }
  return out;
}

/** Every word typed must appear in the name, the explanation, the synonyms or the place. Name matches come first. */
export function findSettings(query: string, scope: Scope, t: Translate): Hit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { hit: Hit; rank: number; at: number }[] = [];
  reachable(scope, t).forEach((hit, at) => {
    const label = fold(t(hit.entry.label));
    const rest = fold([hit.entry.hint ? t(hit.entry.hint) : '', hit.entry.keywords, hit.path].join(' '));
    if (!words.every((w) => label.includes(w) || rest.includes(w))) return;
    const rank = words.every((w) => label.startsWith(w) || label.includes(` ${w}`)) ? 0 : words.every((w) => label.includes(w)) ? 1 : 2;
    scored.push({ hit, rank, at });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.at - b.at).map((s) => s.hit);
}

/** Scrolls the setting into view and outlines it for a moment. The screen may still be opening, so it waits for it. */
export function flashSetting(id: string) {
  let tries = 0;
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(`[data-setting="${id}"]`) ?? document.querySelector<HTMLElement>('[data-setting-area]');
    if (!el) {
      if (++tries < 30) setTimeout(attempt, 50);
      return;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('setting-flash');
    void el.offsetWidth;
    el.classList.add('setting-flash');
    setTimeout(() => el.classList.remove('setting-flash'), 2200);
  };
  setTimeout(attempt, 0);
}
