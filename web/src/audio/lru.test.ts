import { describe, expect, it } from "vitest";
import { LruCache } from "./lru";

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const evicted: number[] = [];
    const lru = new LruCache<number, string>(2, (k) => evicted.push(k));
    lru.set(1, "a");
    lru.set(2, "b");
    lru.get(1); // 2 is now oldest
    lru.set(3, "c");
    expect(evicted).toEqual([2]);
    expect(lru.has(1) && lru.has(3)).toBe(true);
  });
  it("never evicts protected keys", () => {
    const lru = new LruCache<number, string>(2);
    lru.set(1, "a");
    lru.set(2, "b");
    lru.set(3, "c", (k) => k === 1);
    expect([...[1, 2, 3].filter((k) => lru.has(k))]).toEqual([1, 3]);
  });
  it("peek does not refresh recency; clear evicts all", () => {
    const evicted: number[] = [];
    const lru = new LruCache<number, string>(2, (k) => evicted.push(k));
    lru.set(1, "a");
    lru.set(2, "b");
    lru.peek(1);
    lru.set(3, "c");
    expect(evicted).toEqual([1]);
    lru.clear();
    expect(evicted).toEqual([1, 2, 3]);
    expect(lru.size).toBe(0);
  });
});
