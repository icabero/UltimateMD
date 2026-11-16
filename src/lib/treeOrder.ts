import type { SortMode } from './api';
import type { Key } from './i18n.svelte';

/** The orders a vault's tree can have, as they are offered. */
export const ORDERS: { value: SortMode; label: Key }[] = [
  { value: 'nameAsc', label: 'sort.nameAsc' },
  { value: 'nameDesc', label: 'sort.nameDesc' },
  { value: 'modifiedNew', label: 'sort.modifiedNew' },
  { value: 'modifiedOld', label: 'sort.modifiedOld' },
  { value: 'manual', label: 'sort.manual' },
];
