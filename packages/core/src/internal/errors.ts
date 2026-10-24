import type { ValidationIssue } from '../index.js';

export class WorkcoreError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly issues?: ValidationIssue[]) { super(message); }
}

export function safeMessage(error: unknown) {
  return error instanceof WorkcoreError ? error.message.slice(0, 300) : 'Operation failed';
}
