// Global gesture lock — the runtime backstop for what declarative CSS cannot
// reach on older iOS:
//   - `user-scalable=no` in the viewport meta is ignored by iOS 10+,
//   - `overscroll-behavior: none` is only honored from iOS 16 (pull-to-
//     refresh / rubber-band needs the touchmove preventDefault),
//   - pinch-zoom fires Safari's private `gesture*` events (plus multi-touch
//     touchmove) regardless of touch-action,
//   - double-tap zoom needs the touchend 300ms window suppressed.
// Everything registers NON-passive so preventDefault actually applies on
// touch — a passive listener would silently drop it.
//
// Safe by design on this board: the deck drags via Pointer Events
// (pointermove is untouched; touchmove preventDefault does not stop pointer
// dispatch), and there are no scrollable regions, so blanket touchmove
// blocking loses nothing. Mount once from App.vue (VueUse auto-cleanup).
import { useEventListener } from '@vueuse/core';

export function useGestureLock(): void {
  // Scrolling / pull-to-refresh / rubber-band / two-finger pan. One listener
  // covers everything: multi-touch moves also dispatch touchmove.
  useEventListener(
    document,
    'touchmove',
    (e) => e.preventDefault(),
    { passive: false },
  );

  // Safari-private pinch-zoom events — second backstop. Not in the DOM event
  // map, so widen the type to the generic EventListener overload.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend'] as const) {
    useEventListener(
      document,
      type as string,
      (e) => e.preventDefault(),
      { passive: false },
    );
  }

  // Double-tap zoom: suppress the click the second tap would otherwise
  // synthesize within 300ms of the first. (Side effect: touch users can't
  // double-fire a button inside 300ms — acceptable, the engine's busy lock
  // already gates rapid actions.)
  let lastTouchEnd = 0;
  useEventListener(
    document,
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );

  // Long-press / right-click context menu (save image, open link, inspect).
  useEventListener(document, 'contextmenu', (e) => e.preventDefault());
}
