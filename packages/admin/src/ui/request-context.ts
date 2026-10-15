/** Capture user selection identity, not refresh counters. Refreshes may overlap a send. */
export function captureRequestContext(read: () => readonly unknown[]): () => boolean {
  const identity = [...read()];
  return () => {
    const current = read();
    return current.length === identity.length && current.every((value, index) => Object.is(value, identity[index]));
  };
}
