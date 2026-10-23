const cache = new Map<string, { namespace: string; createdAt: number; request: Promise<unknown> }>();
const maxEntries = 256;
const maxAgeMs = 60_000;
let namespaceSequence = 0;

/** A distinct cache scope for each mounted admin instance, even across actor changes in one SPA. */
export function createChatQueryCacheNamespace() {
  return `admin:${++namespaceSequence}`;
}

export function clearChatQueryViewCache(namespace?: string) {
  if (namespace === undefined) { cache.clear(); return; }
  for (const [key, entry] of cache) if (entry.namespace === namespace) cache.delete(key);
}

export function loadCachedChatQueryView(namespace: string, key: string, load: () => Promise<unknown>): Promise<unknown> {
  const scopedKey = `${namespace.length}:${namespace}${key}`;
  const now = Date.now();
  const existing = cache.get(scopedKey);
  if (existing && now - existing.createdAt < maxAgeMs) return existing.request;
  if (existing) cache.delete(scopedKey);
  const request = load();
  cache.set(scopedKey, { namespace, createdAt: now, request });
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  void request.catch(() => {
    if (cache.get(scopedKey)?.request === request) cache.delete(scopedKey);
  });
  return request;
}
