// Filling in a note template: {{titulo}}, {{fecha}}, {{hora}} and {{vault}},
// the same syntax as Word templates. Anything else stays as it is.
import { language } from './i18n.svelte';

export function fillTemplate(text: string, values: { titulo: string; vault: string }, now = new Date()) {
  const known: Record<string, string> = {
    titulo: values.titulo,
    title: values.titulo,
    fecha: now.toLocaleDateString(language()),
    date: now.toLocaleDateString(language()),
    hora: now.toLocaleTimeString(language(), { hour: '2-digit', minute: '2-digit' }),
    time: now.toLocaleTimeString(language(), { hour: '2-digit', minute: '2-digit' }),
    vault: values.vault,
  };
  return text.replace(/\{\{\s*([\p{L}_-]+)\s*\}\}/gu, (match, key: string) => known[key.toLowerCase()] ?? match);
}
