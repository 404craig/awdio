import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Position } from "../../audio/timeline";
import { prefersReducedMotion } from "../../hooks/useMediaQuery";
import { chapterOf, pageName, type DocIndex } from "../../lib/docIndex";
import { player, selectPlaybackPage, useReader } from "../../state/reader";
import { useSettings } from "../../state/settings";
import { highlighter, wordAt } from "./highlight";
import { metrics } from "./metrics";
import { PageView } from "./PageView";

/** Pages rendered around the window centre: [centre − 2, centre + 3]. */
const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 3;
const HOLD_MS = 350;
const HOLD_SLOP_PX = 8;
const DIVIDER_PX = 76;
/** Auto-scroll keeps the active word between 25 % and 60 % of the viewport, landing at 35 %. */
const BAND_TOP = 0.25;
const BAND_BOTTOM = 0.6;
const TARGET = 0.35;
const ANCHOR_Y = 0.3;
const SERIF = '"Literata", Georgia, serif';
const SANS = '"Inter", system-ui, sans-serif';

interface Hold {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  start: Position;
  target: Position | null;
  timer: number;
  raf: number;
  scrubbing: boolean;
}

interface Anchor {
  el: HTMLElement;
  page: number;
  top: number;
}

/** First guess before anything is measured: line height ÷ words per line, plus paragraph spacing. */
function guessPxPerWord(textSize: number): number {
  const width = Math.min(680, window.innerWidth) - 40;
  const wordsPerLine = Math.max(3, width / (textSize * 2.9));
  return ((textSize * 1.7) / wordsPerLine) * 1.12;
}

const isNoDetach = (target: EventTarget | null) =>
  target instanceof Element && target.closest("[data-no-detach]") !== null;

export function ReaderColumn({ index }: { index: DocIndex }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textSize = useSettings((s) => s.settings.textSize);
  const font = useSettings((s) => s.settings.font);
  const [center, setCenter] = useState(() => selectPlaybackPage(useReader.getState()));
  const [layoutVersion, setLayoutVersion] = useState(0);

  const centerRef = useRef(center);
  const heights = useRef(new Map<number, number>());
  const pxPerWord = useRef(guessPxPerWord(textSize));
  const anchor = useRef<Anchor | null>(null);
  const pendingScroll = useRef<ScrollBehavior | null>("auto");
  const hold = useRef<Hold | null>(null);

  const first = Math.max(0, center - WINDOW_BEFORE);
  const last = Math.min(index.pages.length - 1, center + WINDOW_AFTER);
  const range = useRef({ first, last });
  range.current = { first, last };

  // ---- geometry helpers (refs only, so effects can hold them) -------------------

  const sectionEl = (page: number) => rootRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`) ?? null;

  const hitAt = (y: number) => {
    const root = rootRef.current;
    if (!root) return null;
    const r = root.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, y);
    const section = el?.closest<HTMLElement>("[data-page]");
    if (!section || !root.contains(section)) return null;
    return { section, word: el?.closest<HTMLElement>("[data-w]") ?? null, page: Number(section.dataset.page) };
  };

  const captureAnchor = (): Anchor | null => {
    const hit = hitAt(window.innerHeight * ANCHOR_Y);
    const el = hit?.word ?? hit?.section ?? sectionEl(range.current.first);
    if (!el) return null;
    return { el, page: hit?.page ?? range.current.first, top: el.getBoundingClientRect().top };
  };

  const recenter = (page: number) => {
    const c = centerRef.current;
    if (page >= c - 1 && page <= c + WINDOW_AFTER - 1) return;
    anchor.current ??= captureAnchor();
    centerRef.current = page;
    setCenter(page);
  };

  const scrollToY = (top: number, behavior: ScrollBehavior) => {
    const smooth = behavior === "smooth" && !prefersReducedMotion();
    window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  };

  const scrollToActive = (behavior: ScrollBehavior) => {
    const word = highlighter.activeWord;
    if (!word) return;
    const r = word.getBoundingClientRect();
    const far = Math.abs(r.top - window.innerHeight * TARGET) > window.innerHeight * 1.5;
    scrollToY(window.scrollY + r.top - window.innerHeight * TARGET, far ? "auto" : behavior);
  };

  const followActive = () => {
    const word = highlighter.activeWord;
    if (!word) return;
    const r = word.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top < vh * BAND_TOP || r.bottom > vh * BAND_BOTTOM) scrollToActive("smooth");
  };

  /** Bring the playing page into the window and the active word into view. */
  const goToActive = (behavior: ScrollBehavior) => {
    const page = selectPlaybackPage(useReader.getState());
    const { first: f, last: l } = range.current;
    if (page < f || page > l) {
      pendingScroll.current = "auto";
      recenter(page);
    } else {
      scrollToActive(behavior);
    }
  };

  const updateOffscreen = () => {
    const s = useReader.getState();
    let off: "above" | "below" | null = null;
    if (!s.attached) {
      const word = highlighter.activeWord;
      if (word) {
        const r = word.getBoundingClientRect();
        if (r.bottom < metrics.topBarHeight) off = "above";
        else if (r.top > window.innerHeight - metrics.playerHeight) off = "below";
      } else {
        off = selectPlaybackPage(s) < s.viewPage ? "above" : "below";
      }
    }
    if (off !== s.activeOffscreen) useReader.setState({ activeOffscreen: off });
  };

  // ---- after every window/layout change: measure, anchor, highlight, scroll ----------

  useLayoutEffect(() => {
    let px = 0;
    let words = 0;
    for (let p = first; p <= last; p++) {
      const el = sectionEl(p);
      if (!el || el.hasAttribute("data-placeholder")) continue;
      const h = el.offsetHeight;
      heights.current.set(p, h);
      px += h;
      words += index.pageWordCount[p];
    }
    if (words > 0) pxPerWord.current = px / words;

    const a = anchor.current;
    anchor.current = null;
    if (a) {
      const el = a.el.isConnected ? a.el : sectionEl(a.page);
      const delta = el ? el.getBoundingClientRect().top - a.top : 0;
      if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
    }
    highlighter.apply(useReader.getState().position);
    const behavior = pendingScroll.current;
    pendingScroll.current = null;
    if (behavior) scrollToActive(behavior);
    else if (useReader.getState().attached) {
      // Safety net: estimates above the viewport changed; keep the spoken word on screen.
      const r = highlighter.activeWord?.getBoundingClientRect();
      if (r && (r.bottom < 0 || r.top > window.innerHeight)) scrollToActive("auto");
    }
    updateOffscreen();
  }, [first, last, layoutVersion, textSize, font, index]);

  // ---- playback position → highlight / follow -----------------------------------------

  useEffect(() => {
    highlighter.apply(useReader.getState().position);
    const unsub = useReader.subscribe((s, prev) => {
      if (s.position !== prev.position) {
        highlighter.apply(s.position);
        if (s.attached) {
          const page = selectPlaybackPage(s);
          const { first: f, last: l } = range.current;
          if (page < f || page > l) {
            pendingScroll.current = "auto";
            recenter(page);
          } else {
            recenter(page);
            if (useSettings.getState().settings.autoScroll && !hold.current?.scrubbing) followActive();
          }
        }
        updateOffscreen();
      }
      if (s.attached && !prev.attached) goToActive("smooth");
    });
    return () => {
      unsub();
      highlighter.reset();
    };
  }, [index]);

  // ---- text size / font / viewport changes invalidate measurements ----------------------

  useEffect(() => {
    const unsub = useSettings.subscribe((s, prev) => {
      const a = s.settings;
      const b = prev.settings;
      if (a.textSize === b.textSize && a.font === b.font) return;
      heights.current.clear();
      pxPerWord.current *= (a.textSize / b.textSize) ** 2;
      if (useReader.getState().attached) pendingScroll.current = "auto";
      else anchor.current = captureAnchor();
    });
    let timer = 0;
    let alive = true;
    const relayout = () => {
      heights.current.clear();
      if (useReader.getState().attached) pendingScroll.current = "auto";
      else anchor.current = captureAnchor();
      setLayoutVersion((v) => v + 1);
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(relayout, 150);
    };
    window.addEventListener("resize", onResize);
    // Web fonts change line breaks; re-measure once they are in.
    const onFonts = () => alive && relayout();
    document.fonts?.addEventListener("loadingdone", onFonts);
    // Any reflow of rendered pages (fonts, images of text, zoom) moves the spoken word.
    const root = rootRef.current;
    const observer = new ResizeObserver(() => {
      const r = highlighter.activeWord?.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r && useReader.getState().attached && (r.top < vh * 0.1 || r.bottom > vh * 0.75)) scrollToActive("auto");
    });
    if (root) observer.observe(root);
    return () => {
      alive = false;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", onFonts);
      unsub();
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // ---- scrolling: view page, window, detach ----------------------------------------------

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const hit = hitAt(window.innerHeight * ANCHOR_Y);
        const s = useReader.getState();
        if (hit && hit.page !== s.viewPage) useReader.setState({ viewPage: hit.page });
        if (hit && !s.attached) recenter(hit.page);
        updateOffscreen();
      });
    };
    const detach = () => {
      if (useReader.getState().attached && !hold.current?.scrubbing) useReader.setState({ attached: false });
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof Element && e.target.closest('[role="dialog"]'))) detach();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!isNoDetach(e.target)) detach();
    };
    const onKey = (e: KeyboardEvent) => {
      if (["PageUp", "PageDown", "Home", "End"].includes(e.key) && !isNoDetach(e.target)) detach();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === document.documentElement) detach(); // scrollbar drag
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  // ---- tap a word / press-and-hold scrub ------------------------------------------------

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // While scrubbing, stop the browser from scrolling (touch-action can't change mid-gesture).
    const block = (e: TouchEvent) => {
      if (hold.current?.scrubbing) e.preventDefault();
    };
    root.addEventListener("touchmove", block, { passive: false });
    return () => root.removeEventListener("touchmove", block);
  }, []);

  const scrubAt = (h: Hold) => {
    const hit = wordAt(document.elementFromPoint(h.lastX, h.lastY));
    if (hit) {
      h.target = hit.pos;
      highlighter.setScrub(hit.el);
    }
    const page = index.pageOfBlock[(h.target ?? h.start).blockIndex];
    useReader.setState({ textScrub: { x: h.lastX, y: h.lastY, page } });
  };

  const edgeScroll = () => {
    const h = hold.current;
    if (!h?.scrubbing) return;
    const top = metrics.topBarHeight + 48;
    const bottom = window.innerHeight - metrics.playerHeight - 48;
    const dy = h.lastY < top ? -(top - h.lastY) * 0.3 : h.lastY > bottom ? (h.lastY - bottom) * 0.3 : 0;
    if (dy) {
      window.scrollBy(0, Math.max(-28, Math.min(28, dy)));
      scrubAt(h);
    }
    h.raf = requestAnimationFrame(edgeScroll);
  };

  const endHold = () => {
    const h = hold.current;
    if (!h) return;
    clearTimeout(h.timer);
    cancelAnimationFrame(h.raf);
    hold.current = null;
    rootRef.current?.classList.remove("is-scrubbing");
    highlighter.setScrub(null);
    if (useReader.getState().textScrub) useReader.setState({ textScrub: null });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || hold.current) return;
    const hit = wordAt(e.target);
    if (!hit) return;
    const h: Hold = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      start: hit.pos,
      target: null,
      timer: 0,
      raf: 0,
      scrubbing: false,
    };
    h.timer = window.setTimeout(() => {
      h.scrubbing = true;
      const root = rootRef.current;
      root?.classList.add("is-scrubbing");
      try {
        root?.setPointerCapture(h.id);
      } catch {
        /* pointer already gone */
      }
      window.getSelection()?.removeAllRanges();
      navigator.vibrate?.(8);
      scrubAt(h);
      h.raf = requestAnimationFrame(edgeScroll);
    }, HOLD_MS);
    hold.current = h;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    if (!h || e.pointerId !== h.id) return;
    h.lastX = e.clientX;
    h.lastY = e.clientY;
    if (h.scrubbing) {
      e.preventDefault();
      scrubAt(h);
    } else if (Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP_PX) {
      endHold();
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const h = hold.current;
    if (!h || e.pointerId !== h.id) return;
    const target = h.scrubbing ? (h.target ?? h.start) : h.start;
    endHold();
    player.seekTo(target, { play: true });
  };

  return (
    <div
      ref={rootRef}
      className="reading mx-auto max-w-[680px] px-6 sm:px-10"
      style={{
        fontSize: textSize,
        fontFamily: font === "sans" ? SANS : SERIF,
        paddingTop: "calc(var(--safe-top) + var(--topbar-h) + 28px)",
        paddingBottom: "calc(var(--player-h, 180px) + 45vh)",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endHold}
      onContextMenu={(e) => hold.current && e.preventDefault()}
    >
      {index.pages.map((page) => {
        const rendered = page.index >= first && page.index <= last;
        const estimate =
          heights.current.get(page.index) ??
          Math.round(index.pageWordCount[page.index] * pxPerWord.current + (page.index > 0 ? DIVIDER_PX : 0));
        const chapter = chapterOf(page);
        const label = chapter ? `${pageName(page)} · ${chapter}` : pageName(page);
        return <PageView key={page.index} page={page} label={label} placeholderHeight={rendered ? null : estimate} />;
      })}
    </div>
  );
}
