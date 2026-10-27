/**
 * Imperative highlighting: the reader never re-renders per word. Blocks register their
 * element here; the active word is the block's n-th child span.
 */
import type { Position } from "../../audio/timeline";

const blockEls = new Map<number, HTMLElement>();

export function registerBlock(index: number, el: HTMLElement | null): void {
  if (el) blockEls.set(index, el);
  else blockEls.delete(index);
}

const wordEl = (pos: Position): HTMLElement | null =>
  (blockEls.get(pos.blockIndex)?.children[pos.wordIndex] as HTMLElement | undefined) ?? null;

/** Word span under a DOM node (event target or elementFromPoint result). */
export function wordAt(node: EventTarget | Element | null): { el: HTMLElement; pos: Position } | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>("[data-w]");
  if (!el) return null;
  return { el, pos: { blockIndex: Number(el.dataset.b), wordIndex: Number(el.dataset.w) } };
}

class Highlighter {
  private pos: Position | null = null;
  private word: HTMLElement | null = null;
  private block: HTMLElement | null = null;
  private scrubWord: HTMLElement | null = null;

  /** Toggle classes for `pos`. Cheap when nothing changed; call again after DOM changes. */
  apply(pos: Position): void {
    this.pos = pos;
    const block = blockEls.get(pos.blockIndex) ?? null;
    if (block !== this.block) {
      this.block?.classList.remove("is-current");
      block?.classList.add("is-current");
      this.block = block;
    }
    const word = wordEl(pos);
    if (word !== this.word) {
      this.word?.classList.remove("is-active");
      word?.classList.add("is-active");
      this.word = word;
    }
  }

  refresh(): void {
    if (this.pos) this.apply(this.pos);
  }

  get activeWord(): HTMLElement | null {
    return this.word?.isConnected ? this.word : null;
  }

  setScrub(el: HTMLElement | null): void {
    if (el === this.scrubWord) return;
    this.scrubWord?.classList.remove("is-scrub");
    el?.classList.add("is-scrub");
    this.scrubWord = el;
  }

  reset(): void {
    this.block?.classList.remove("is-current");
    this.word?.classList.remove("is-active");
    this.setScrub(null);
    this.pos = this.word = this.block = null;
  }
}

export const highlighter = new Highlighter();
