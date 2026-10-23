export type QuerySourceStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error';
export type QuerySourceFailure = { kind: 'forbidden' | 'request'; message: string };

export interface QuerySourceSnapshot<Result> {
  status: QuerySourceStatus;
  result?: Result;
  hasResult: boolean;
  stale: boolean;
  error: QuerySourceFailure | null;
}

/** Per-instance query lifecycle with generation and context guards. */
export class QuerySourceController<Result> {
  private generation = 0;
  private current: QuerySourceSnapshot<Result> = { status: 'idle', hasResult: false, stale: false, error: null };

  snapshot(): QuerySourceSnapshot<Result> {
    return { ...this.current, error: this.current.error ? { ...this.current.error } : null };
  }

  async run(load: () => Promise<Result>, isContextCurrent: () => boolean = () => true): Promise<boolean> {
    const generation = ++this.generation;
    this.current = {
      ...this.current,
      status: this.current.hasResult ? 'refreshing' : 'loading',
      error: null,
    };
    try {
      const result = await load();
      if (generation !== this.generation) return false;
      if (!isContextCurrent()) { this.dispose(); return false; }
      this.current = { status: 'ready', result, hasResult: true, stale: false, error: null };
      return true;
    } catch (cause) {
      if (generation !== this.generation) return false;
      if (!isContextCurrent()) { this.dispose(); return false; }
      this.recordError(cause);
      return false;
    }
  }

  setError(cause: unknown): void {
    this.generation++;
    this.recordError(cause);
  }

  private recordError(cause: unknown): void {
    const code = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
    const error = { kind: code === 'FORBIDDEN' || code === 'UNAUTHENTICATED' ? 'forbidden' as const : 'request' as const, message: cause instanceof Error ? cause.message : String(cause) };
    // Access loss invalidates the source identity: never retain protected results as stale data.
    this.current = error.kind === 'forbidden'
      ? { status: 'error', hasResult: false, stale: false, error }
      : { ...this.current, status: 'error', error };
  }

  invalidate(): void {
    this.generation++;
    this.current = { ...this.current, status: this.current.hasResult ? 'ready' : 'idle', stale: this.current.hasResult, error: null };
  }

  dispose(): void {
    this.generation++;
    this.current = { status: 'idle', hasResult: false, stale: false, error: null };
  }
}
