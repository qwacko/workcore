import { describe, expect, it } from 'vitest';
import { buildChartSeries, chartCategories } from './chart-data.js';

describe('chart data shaping', () => {
  it('groups finite numeric values by the configured series and category', () => {
    const rows = [
      { day: 'Mon', count: 2, team: 'A' },
      { day: 'Mon', count: 3, team: 'B' },
      { day: 'Tue', count: 4, team: 'A' },
      { day: 'Tue', count: Number.NaN, team: 'B' },
      { day: 'Wed', count: Number.NaN, team: 'A' },
    ];
    const config = { xField: 'day', yField: 'count', seriesField: 'team' };
    expect(chartCategories(rows, config)).toEqual(['Mon', 'Tue', 'Wed']);
    expect(buildChartSeries(rows, config)).toEqual([
      { name: 'A', points: [{ index: 0, label: 'Mon', value: 2 }, { index: 1, label: 'Tue', value: 4 }] },
      { name: 'B', points: [{ index: 0, label: 'Mon', value: 3 }] },
    ]);
  });

  it('resolves nested fields and returns no series for nonnumeric values', () => {
    expect(buildChartSeries([{ date: { label: 'today' }, metric: '4' }], { xField: 'date.label', yField: 'metric' })).toEqual([]);
  });
});
