import type { AgentEngine } from '@workcore/core';

type MiloPrompt = {
  conversationId: string;
  assistantMessageId: string;
  userMessage: string;
  recentMessages?: Array<{ role: 'user' | 'assistant'; text: string }>;
};

/** Offline, deterministic fallback so the chat example works without a provider key. */
export const miloDemoEngine: AgentEngine = {
  async run(args) {
    const prompt = JSON.parse(args.prompt) as MiloPrompt;
    const userText = prompt.userMessage.trim();
  const history = prompt.recentMessages ?? [];
    const reply = makeMiloReply(userText, history);
    await args.onEvent({ type: 'step.started', data: { stepNumber: 0, mode: 'local-demo' } });
    const finishTool = args.tools[args.finishTool];
    if (!finishTool) throw new Error(`Milo's finish tool '${args.finishTool}' was not configured`);
    // Keep a short pause so the example exercises the same pending-run UI as a hosted model.
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(args.signal.reason ?? new Error('Agent run aborted'));
      };
      const timer = setTimeout(() => {
        args.signal.removeEventListener('abort', onAbort);
        resolve();
      }, 700);
      if (args.signal.aborted) onAbort();
      else args.signal.addEventListener('abort', onAbort, { once: true });
    });
    await finishTool.execute({ conversationId: prompt.conversationId, assistantMessageId: prompt.assistantMessageId, text: reply }, args.signal);
    await args.onEvent({ type: 'step.completed', data: { stepNumber: 0, finishReason: 'tool-calls', text: reply } });
    return { output: reply, finishReason: 'tool-calls', finishTool: args.finishTool };
  },
};

function makeMiloReply(message: string, history: NonNullable<MiloPrompt['recentMessages']>) {
  const normalized = message.toLowerCase();
  const topic = message.replace(/\s+/g, ' ').slice(0, 120);
  if (/what can you do|how can you help|who are you/.test(normalized)) {
    return 'I’m Milo, your cheerful trail buddy. I can help you think through plans, untangle a question, or find one small next step. What’s on your mind?';
  }
  if (/\b(run|hike|walk|trail|workout|training|ride)\b/.test(normalized)) {
    return `That sounds like a good trail to explore: “${topic}.” I’d start with one easy milestone, leave a little room for surprise, and call that a win. What would make this feel doable for you?`;
  }
  if (message.endsWith('?')) {
    const continuity = history.length > 1 ? 'Keeping our conversation in view, ' : '';
    return `${continuity}good question. I’d take it one trail marker at a time rather than trying to solve the whole map at once. What part feels most important right now?`;
  }
  return `Thanks for sharing that with me. “${topic}” sounds worth taking seriously. Let’s find one small next step together—what would be most useful to figure out first?`;
}
