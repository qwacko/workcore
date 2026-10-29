import type { Json } from '@workcore/core';
import { readPath, text } from './data.js';

export type CollectionViewOptions = {
  search: string;
  searchPaths: string[];
  filters: Array<{ path: string; value?: string }>;
  sorting: string;
};

/** Typed table/list view model. It derives a presentation from supplied rows and never loads data. */
export function useCollectionView<TRow extends Json>(
  getRows: () => readonly TRow[],
  getOptions: () => CollectionViewOptions,
): { readonly rows: TRow[] } {
  let rows = $derived.by(() => {
    const options = getOptions();
    let result = getRows().filter(row => {
      const haystack = options.searchPaths.map(path => text(readPath(row, path))).join(' ').toLowerCase();
      if (options.search && !haystack.includes(options.search.toLowerCase())) return false;
      return options.filters.every(filter => !filter.value || JSON.stringify(readPath(row, filter.path)) === filter.value);
    });
    if (options.sorting) {
      const descending = options.sorting.startsWith('-');
      const path = descending ? options.sorting.slice(1) : options.sorting;
      result = [...result].sort((a, b) => {
        const left = readPath(a, path), right = readPath(b, path);
        const compared = typeof left === 'number' && typeof right === 'number' ? left - right : text(left).localeCompare(text(right));
        return descending ? -compared : compared;
      });
    }
    return result;
  });
  return { get rows() { return rows; } };
}
