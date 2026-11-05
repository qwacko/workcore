import { z } from 'zod';

/** Application data references, independent of Workcore's optional admin renderer. */
export const chatPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(20_000) }).strict(),
  z.object({ type: z.literal('task'), taskId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      type: z.literal('task-list'),
      projectId: z.string().min(1).max(100).default('inbox'),
      status: z.enum(['all', 'open', 'done']).default('open'),
    })
    .strict(),
  z.object({ type: z.literal('note'), noteId: z.string().min(1).max(200) }).strict(),
  z
    .object({
      type: z.literal('note-list'),
      query: z.string().max(200).default(''),
      starredOnly: z.boolean().default(false),
    })
    .strict(),
]);
export type ChatPart = z.output<typeof chatPartSchema>;

/** Preserve old conversation text and known data references without executing old layouts. */
export function readChatParts(stored: string): ChatPart[] {
  let values: unknown;
  try {
    values = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(values)) return [];
  return values.slice(0, 20).flatMap<ChatPart>((value) => {
    const parsed = chatPartSchema.safeParse(value);
    if (parsed.success) return [parsed.data];
    if (value?.type !== 'display') return [];
    if (value.display === 'chatTasks')
      return [
        {
          type: 'task-list' as const,
          projectId: 'inbox',
          status:
            value.input?.status === 'done'
              ? ('done' as const)
              : value.input?.status === 'all'
                ? ('all' as const)
                : ('open' as const),
        },
      ];
    if (value.display === 'chatNotes')
      return [
        {
          type: 'note-list' as const,
          query: typeof value.input?.query === 'string' ? value.input.query.slice(0, 200) : '',
          starredOnly: value.input?.starredOnly === true,
        },
      ];
    return [];
  });
}
