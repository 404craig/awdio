/** Small insertion-ordered LRU. `onEvict` runs for every entry removed by capacity or clear(). */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    private readonly capacity: number,
    private readonly onEvict: (key: K, value: V) => void = () => {},
  ) {}

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Read without refreshing recency. */
  peek(key: K): V | undefined {
    return this.map.get(key);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  /** Inserts and evicts the least recently used entries that `keep` does not protect. */
  set(key: K, value: V, keep: (key: K) => boolean = () => false): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size <= this.capacity) return;
    for (const [k, v] of this.map) {
      if (this.map.size <= this.capacity) break;
      if (k === key || keep(k)) continue;
      this.map.delete(k);
      this.onEvict(k, v);
    }
  }

  clear(): void {
    for (const [k, v] of this.map) this.onEvict(k, v);
    this.map.clear();
  }
}
