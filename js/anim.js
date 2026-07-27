// FLIP (First–Last–Invert–Play) helpers for animating every card that
// changes position between renders, plus shared timing constants that the
// drag controller reuses for a consistent "fly-back" feel.

export const FLIP_MS = 240;
export const FLIP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

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
  if (!anims.length) return;

  requestAnimationFrame(() => {
    for (const el of anims) {
      el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
      el.style.transform = '';
    }
  });

  // Drop the inline overrides once settled so the base `.card` style wins again
  // and nothing leaks into the next animation cycle.
  setTimeout(() => {
    for (const el of anims) {
      el.style.transition = '';
      el.style.transform = '';
    }
  }, FLIP_MS + 60);
}
