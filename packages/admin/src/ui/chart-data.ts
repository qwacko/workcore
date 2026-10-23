import type { OperationViewVariant } from '@workcore/core';
import { getCollectionFieldValue } from './collection-editor.js';

export type ChartPoint = { index: number; label: string; value: number };
export type ChartSeries = { name: string; points: ChartPoint[] };

export function chartCategories(rows: Array<Record<string, unknown>>, config: NonNullable<OperationViewVariant['chart']>): string[] {
  return [...new Set(rows.map((row) => {
    const value = getCollectionFieldValue(row, config.xField);
    return value == null ? '' : String(value);
  }))];
}

/** Convert a declared row chart into stable, finite, grouped series for rendering. */
export function buildChartSeries(rows: Array<Record<string, unknown>>, config: NonNullable<OperationViewVariant['chart']>): ChartSeries[] {
  const categories = chartCategories(rows, config);
  const categoryIndexes = new Map(categories.map((label, index) => [label, index]));
  const groups = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const rawLabel = getCollectionFieldValue(row, config.xField);
    const label = rawLabel == null ? '' : String(rawLabel);
    const index = categoryIndexes.get(label)!;
    const rawValue = getCollectionFieldValue(row, config.yField);
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue;
    const rawSeries = config.seriesField ? getCollectionFieldValue(row, config.seriesField) : undefined;
    const name = rawSeries == null ? 'Series' : String(rawSeries);
    let points = groups.get(name);
    if (!points) { points = new Map(); groups.set(name, points); }
    points.set(index, rawValue);
  }
  return [...groups].map(([name, values]) => ({
    name,
    points: [...values].map(([index, value]) => ({ index, label: categories[index] ?? '', value })),
  }));
}
