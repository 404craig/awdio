/**
 * iOS lock screen and Control Centre: speech synthesis alone gets no "Now Playing" card and
 * may be suspended when the phone locks. A silent looping <audio> started inside the play
 * gesture keeps the page's audio session alive, and the Media Session API supplies the
 * title, artwork and buttons.
 */
import type { LockScreen, LockScreenHandlers } from "./speech";
import { silentWavDataUri } from "./silence";

const SKIP_SECONDS = 15;

export function browserLockScreen(baseUrl: string): LockScreen {
  let keepAliveEl: HTMLAudioElement | null = null;
  const session = typeof navigator !== "undefined" && "mediaSession" in navigator ? navigator.mediaSession : null;
  const artwork = [
    { src: `${baseUrl}icons/icon-192.png`, sizes: "192x192", type: "image/png" },
    { src: `${baseUrl}icons/icon-512.png`, sizes: "512x512", type: "image/png" },
  ];

  const setHandlers = (h: LockScreenHandlers | null) => {
    const entries: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ["play", h && (() => h.play())],
      ["pause", h && (() => h.pause())],
      ["seekbackward", h && ((d) => h.skip(-(d.seekOffset ?? SKIP_SECONDS)))],
      ["seekforward", h && ((d) => h.skip(d.seekOffset ?? SKIP_SECONDS))],
      ["previoustrack", h && (() => h.previous())],
      ["nexttrack", h && (() => h.next())],
      ["seekto", h && ((d) => d.seekTime !== undefined && h.seekTo(d.seekTime))],
    ];
    for (const [action, handler] of entries) {
      try {
        session?.setActionHandler(action, handler);
      } catch {
        /* action not supported by this browser */
      }
    }
  };

  return {
    activate(title, handlers) {
      if (!session) return;
      if (typeof MediaMetadata !== "undefined") session.metadata = new MediaMetadata({ title, artist: "awdio", artwork });
      setHandlers(handlers);
    },
    deactivate() {
      keepAliveEl?.pause();
      if (!session) return;
      setHandlers(null);
      session.metadata = null;
      session.playbackState = "none";
    },
    keepAlive(on) {
      if (!on) {
        keepAliveEl?.pause();
        return;
      }
      if (!keepAliveEl) {
        keepAliveEl = new Audio(silentWavDataUri(2));
        keepAliveEl.loop = true;
        keepAliveEl.setAttribute("playsinline", "");
      }
      keepAliveEl.play().catch(() => {
        /* not allowed outside a gesture: speech still works, only the lock screen card is missing */
      });
    },
    setPlaying(playing) {
      if (session) session.playbackState = playing ? "playing" : "paused";
    },
    setPosition(state) {
      if (!session?.setPositionState) return;
      try {
        session.setPositionState(state ? { ...state, position: Math.min(state.position, state.duration) } : undefined);
      } catch {
        /* invalid state (e.g. zero duration) */
      }
    },
  };
}
