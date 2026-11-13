import { IS_MAC } from './frame.svelte';
import { tr, type Key } from './i18n.svelte';

/** A key as the keyboard in front of the user names it. */
export function keyLabel(key: string) {
  if (key === 'Shift') return IS_MAC ? '⇧' : tr('keys.shift');
  if (IS_MAC && key === 'Ctrl') return '⌘';
  if (IS_MAC && key === 'Alt') return '⌥';
  if (key === 'Click') return tr('keys.click');
  if (key === 'Enter') return tr('keys.enter');
  if (key === 'Del') return tr('keys.delete');
  return key;
}

export interface Shortcut {
  label: Key;
  /** Each entry is one way to press it; most have one. */
  keys: string[][];
}

/** Every shortcut of the app, grouped as the list shows them. */
export const SHORTCUTS: { title: Key; items: Shortcut[] }[] = [
  {
    title: 'shortcuts.general',
    items: [
      { label: 'cmd.openNote', keys: [['Ctrl', 'P']] },
      { label: 'shortcuts.actions', keys: [['Ctrl', 'Shift', 'P']] },
      { label: 'cmd.newNote', keys: [['Ctrl', 'N']] },
      { label: 'daily.open', keys: [['Ctrl', 'Shift', 'D']] },
      { label: 'cmd.searchAll', keys: [['Ctrl', 'Shift', 'F']] },
      { label: 'cmd.saveAll', keys: [['Ctrl', 'S']] },
      { label: 'cmd.export', keys: [['Ctrl', 'E']] },
      { label: 'cmd.shortcuts', keys: [['Ctrl', '/']] },
      { label: 'shortcuts.closeDialog', keys: [['Esc']] },
    ],
  },
  {
    title: 'shortcuts.layout',
    items: [
      { label: 'cmd.nextTab', keys: [['Ctrl', 'Tab']] },
      { label: 'shortcuts.previousTab', keys: [['Ctrl', 'Shift', 'Tab']] },
      { label: 'cmd.closeTab', keys: [['Ctrl', 'W']] },
      { label: 'cmd.closeAllTabs', keys: [['Ctrl', 'Shift', 'W']] },
      { label: 'shortcuts.nextView', keys: [['Ctrl', '\\']] },
      { label: 'cmd.toggleSidebar', keys: [['Ctrl', 'Shift', 'E']] },
      { label: 'cmd.togglePanel', keys: [['Ctrl', 'Shift', 'O']] },
      { label: 'cmd.focus', keys: [['Ctrl', 'Shift', 'Enter']] },
      { label: 'shortcuts.moveTab', keys: [['Ctrl', 'Shift', '←'], ['Ctrl', 'Shift', '→']] },
      { label: 'cmd.zoomIn', keys: [['Ctrl', '+']] },
      { label: 'cmd.zoomOut', keys: [['Ctrl', '-']] },
      { label: 'cmd.zoomReset', keys: [['Ctrl', '0']] },
    ],
  },
  {
    title: 'shortcuts.tree',
    items: [
      { label: 'shortcuts.treeMove', keys: [['↑'], ['↓']] },
      { label: 'shortcuts.treeOpen', keys: [['→'], ['←']] },
      { label: 'shortcuts.treeEnter', keys: [['Enter']] },
      { label: 'common.rename', keys: [['F2']] },
      { label: 'sidebar.trash', keys: [['Del']] },
      { label: 'shortcuts.menu', keys: [['Shift', 'F10']] },
    ],
  },
  {
    title: 'shortcuts.writing',
    items: [
      { label: 'shortcuts.bold', keys: [['Ctrl', 'B']] },
      { label: 'shortcuts.italic', keys: [['Ctrl', 'I']] },
      { label: 'shortcuts.link', keys: [['Ctrl', 'K']] },
      { label: 'shortcuts.slash', keys: [['/']] },
      { label: 'shortcuts.followLink', keys: [['Ctrl', 'Click']] },
      { label: 'shortcuts.pastePlain', keys: [['Ctrl', 'Shift', 'V']] },
      { label: 'shortcuts.undo', keys: [['Ctrl', 'Z']] },
      { label: 'shortcuts.redo', keys: [['Ctrl', 'Shift', 'Z'], ['Ctrl', 'Y']] },
      { label: 'shortcuts.indent', keys: [['Tab'], ['Shift', 'Tab']] },
      { label: 'shortcuts.moveLine', keys: [['Alt', '↑'], ['Alt', '↓']] },
      { label: 'shortcuts.moveTableRow', keys: [['Alt', '↑'], ['Alt', '↓']] },
      { label: 'shortcuts.moveTableColumn', keys: [['Alt', '←'], ['Alt', '→']] },
      { label: 'shortcuts.selectNext', keys: [['Ctrl', 'D']] },
      { label: 'shortcuts.toggleTask', keys: [['Ctrl', 'Enter']] },
      { label: 'shortcuts.sortLines', keys: [['Alt', 'Shift', 'S']] },
      { label: 'shortcuts.fold', keys: [['Ctrl', 'Shift', '['], ['Ctrl', 'Shift', ']']] },
    ],
  },
  {
    title: 'shortcuts.find',
    items: [
      { label: 'shortcuts.findInNote', keys: [['Ctrl', 'F']] },
      { label: 'shortcuts.findNext', keys: [['F3'], ['Ctrl', 'G']] },
      { label: 'shortcuts.findPrevious', keys: [['Shift', 'F3']] },
      { label: 'shortcuts.goToLine', keys: [['Ctrl', 'Alt', 'G']] },
    ],
  },
];
