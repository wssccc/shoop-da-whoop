// Global gesture lock — the runtime backstop for what declarative CSS cannot
// reach on older iOS:
//   - `user-scalable=no` in the viewport meta is ignored by iOS 10+,
//   - `overscroll-behavior: none` is only honored from iOS 16 (pull-to-
//     refresh / rubber-band needs the touchmove preventDefault),
//   - pinch-zoom fires Safari's private `gesture*` events (plus multi-touch
//     touchmove) regardless of touch-action,
//   - double-tap zoom, whose supported switch is declarative (`touch-action:
//     none` on every element — index.css); a JS `touchend` guard cannot stop
//     it, see the note above the `dblclick` listener below.
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

  // Double-tap zoom is NOT suppressed here any more. The old trick —
  // `preventDefault` on the second `touchend` within 300ms — did neither job:
  //   * it never stopped the zoom on modern WebKit: the page zoom is a GESTURE
  //     decision, taken independently of the synthesized click, so a button
  //     double-tap still zoomed (every element without a `touch-action` opt-out
  //     is fair game — only the cards, which declare `none`, stayed put),
  //   * it DID swallow the click of every tap that followed another tap inside
  //     300ms, so rapid re-taps / button-to-button taps were silently dropped
  //     (the "button sometimes doesn't respond until you wait" report).
  // The supported switch is the declarative one: `* { touch-action: none }` in
  // index.css — `touch-action` is what WebKit documents for opting a touch
  // region out of double-tap recognition
  // (https://webkit.org/blog/5610/more-responsive-tapping-on-ios/). The
  // `dblclick` guard below is belt-and-braces for engines that still arm
  // something on the second tap; it never blocks a click.
  useEventListener(document, 'dblclick', (e) => e.preventDefault());

  // Long-press / right-click context menu (save image, open link, inspect).
  useEventListener(document, 'contextmenu', (e) => e.preventDefault());
}
