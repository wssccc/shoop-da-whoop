// FLIP (First–Last–Invert–Play) helpers for animating every card that
// changes position between renders, plus shared timing constants that the
// drag controller reuses for a consistent "fly-back" feel.

export const FLIP_MS = 240;
export const FLIP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// When MANY cards move in one render — i.e. an auto-move cascade (safe aces /
// flowers flying to the foundation after a move, or the final solve) — slow the
// flight down and stagger each card so they read as "collecting one after
// another" instead of teleporting in lock-step. Unlocked heuristically from
// how many cards are moving, so ordinary single-card drags / undos keep the
// snappy 240ms feedback.
const CASCADE_MS = 420;
const CASCADE_STAGGER = 70;
const CASCADE_THRESHOLD = 2; // >= this many moving cards → slow + stagger

// Record every card's current viewport rect (keyed by data-id) BEFORE the DOM
// is rebuilt. CSS transforms are reflected in getBoundingClientRect, which is
// what lets the drag controller "seed" a card's first-position at its drop
// point and have the subsequent render's FLIP carry it to its destination.
export function captureRects(root) {
  const map = new Map();
  root.querySelectorAll('.card[data-id]').forEach((el) => {
    map.set(el.dataset.id, el.getBoundingClientRect());
  });
  return map;
}

// After the DOM is rebuilt, move each card that now occupies a different rect
// back to where it was (invert), then—on the next frame—let it ease into place.
// Returns the total animation time (ms) so callers can defer follow-up work —
// e.g. delaying the win modal until the final foundation flight has landed.
export function playFlip(root, firstRects) {
  const anims = [];
  root.querySelectorAll('.card[data-id]').forEach((el) => {
    const first = firstRects.get(el.dataset.id);
    if (!first) return; // new card (dealt/etc.) — nothing to animate from
    const last = el.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return; // didn't move
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    anims.push(el);
  });
  if (!anims.length) return 0;

  const cascade = anims.length >= CASCADE_THRESHOLD;
  const ms = cascade ? CASCADE_MS : FLIP_MS;
  const stagger = cascade ? CASCADE_STAGGER : 0;

  requestAnimationFrame(() => {
    anims.forEach((el, i) => {
      // Fold the per-card delay into the `transition` shorthand itself — setting
      // `transitionDelay` separately then overwriting with the `transition`
      // shorthand would reset the delay to 0 (shorthand includes delay).
      const delay = i * stagger;
      el.style.transition = `transform ${ms}ms ${FLIP_EASE}${delay ? ' ' + delay + 'ms' : ''}`;
      el.style.transform = '';
    });
  });

  // Last card starts at (n-1)*stagger, then takes `ms` to land. Clean up inline
  // overrides once the whole sequence has settled so the base `.card` style
  // wins again and nothing leaks into the next animation cycle.
  const totalMs = ms + (anims.length - 1) * stagger;
  setTimeout(() => {
    for (const el of anims) {
      el.style.transition = '';
      el.style.transform = '';
    }
  }, totalMs + 60);

  return totalMs;
}
