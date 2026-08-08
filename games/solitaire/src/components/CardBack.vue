<script setup lang="ts">
/**
 * CardBack — the card-back face shown on a LOCKED dragon pile.
 *
 * After 收龙 completes, the pile flips over (see App.vue `.locked-dragons`
 * flip structure / index.css) and presents ONE card back: the blue
 * diamond-grid playing-card back (`/images/card-back.svg`, shared with the
 * WinCard — one deck, one identity). The per-colour locked slot frame
 * (`.slot.locked.c-*`) keeps colour identification.
 *
 * Rendered as a plain <img> (not inline SVG): the source SVG carries its own
 * pattern/filter ids, so inlining would collide across the 3 pile instances
 * + the WinCard. An <img> reference sidesteps the id-scoping entirely and
 * is iOS 13 / Safari 13 safe.
 */
</script>

<template>
  <div class="card-back" aria-hidden="true">
    <img src="/images/card-back.svg" alt="" draggable="false" />
  </div>
</template>
