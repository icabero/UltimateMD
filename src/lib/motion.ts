// Short transitions for the interface, 120 to 180 ms like --duration-fast and
// --duration-base. With "reduce motion" on in the system they take no time.
import { cubicOut } from 'svelte/easing';
import { fade, fly, slide, type TransitionConfig } from 'svelte/transition';

export const FAST = 120;
export const BASE = 180;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const time = (ms: number) => (reduced() ? 0 : ms);

/**
 * A dialog appearing: a fade and a slight growth. It uses `scale` rather than
 * `transform`, so dialogs centred with a translate stay where they are.
 */
export function pop(_node: Element, { duration = BASE } = {}): TransitionConfig {
  return {
    duration: time(duration),
    easing: cubicOut,
    css: (t) => `opacity: ${t}; scale: ${0.97 + 0.03 * t};`,
  };
}

/** The dark layer behind a dialog. */
export const dim = (node: Element) => fade(node, { duration: time(FAST) });

/** A notice coming up from the bottom. */
export const rise = (node: Element) => fly(node, { y: 8, duration: time(BASE), easing: cubicOut });

/** A new tab sliding in from the side. */
export const enter = (node: Element) => fly(node, { x: -6, duration: time(FAST), easing: cubicOut });

/** A folder opening or closing. */
export const unfold = (node: Element) => slide(node, { duration: time(FAST), easing: cubicOut });

/** A short change of text, such as "Saving…" to "Saved". */
export const swap = (node: Element) => fade(node, { duration: time(FAST) });
