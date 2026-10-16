// A bounded, per-worker cache for PUBLIC reads only. Concurrent readers share
// one promise; failed reads are removed immediately and never served as success.
export function createCoalescedRead<T>(ttlMs: number, capacity = 128) {
  const entries = new Map<string, { value: Promise<T>; expiresAt: number }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const existing = entries.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.value;
    if (entries.size >= capacity) entries.delete(entries.keys().next().value!);
    const entry = { value: Promise.resolve().then(load), expiresAt: Number.POSITIVE_INFINITY };
    entries.set(key, entry);
    entry.value.then(() => { entry.expiresAt = Date.now() + ttlMs; }, () => { if (entries.get(key) === entry) entries.delete(key); });
    return entry.value;
  };
}
