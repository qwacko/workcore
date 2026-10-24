export function isSupportedCron(value: string) {
  const fields = value.trim().split(/\s+/);
  const bounds: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  if (fields.length !== bounds.length) return false;
  return fields.every((field, index) => field.split(',').every((part) => {
    const [minimum, maximum] = bounds[index]!;
    if (part === '*') return true;
    if (/^\*\/\d+$/.test(part)) { const step = Number(part.slice(2)); return step > 0 && step <= maximum - minimum + 1; }
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) { const start = Number(range[1]); const end = Number(range[2]); return start >= minimum && end <= maximum && start <= end; }
    if (/^\d+$/.test(part)) { const number = Number(part); return number >= minimum && number <= maximum; }
    return false;
  }));
}

export function nextScheduleOccurrence(cron: string, from: Date, timezone: string): Date {
  const parts = cron.trim().split(/\s+/);
  const matches = (part: string, value: number) => part === '*' || part.split(',').some((chunk) => {
    if (chunk.startsWith('*/')) return value % Number(chunk.slice(2)) === 0;
    if (chunk.includes('-')) { const [a, b] = chunk.split('-').map(Number); return value >= a! && value <= b!; }
    return Number(chunk) === value;
  });
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, minute: 'numeric', hour: 'numeric', day: 'numeric', month: 'numeric', weekday: 'short', hourCycle: 'h23' });
  const next = new Date(from.getTime()); next.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 370; i++) {
    next.setMinutes(next.getMinutes() + 1);
    const values = Object.fromEntries(formatter.formatToParts(next).map((part) => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday ?? '');
    if (matches(parts[0]!, Number(values.minute)) && matches(parts[1]!, Number(values.hour)) && matches(parts[2]!, Number(values.day)) && matches(parts[3]!, Number(values.month)) && matches(parts[4]!, weekday)) return next;
  }
  throw new Error('Could not calculate next schedule occurrence');
}
