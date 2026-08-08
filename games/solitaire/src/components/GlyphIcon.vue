<script setup lang="ts">
/**
 * GlyphIcon — single-colour UI icons for the Solitaire chrome.
 *
 * Thin wrapper over lucide-vue-next (already a workspace dependency, used by
 * the Othello entry): crisp stroke-based vector icons that inherit
 * `currentColor`, so each call site tints the icon via its own CSS `color`
 * (locked-cell colour frames, …). No icon font, no external assets — icons
 * are tree-shaken per import and safe on iOS 13 / Safari 13 (the legacy
 * bundle transpiles them).
 *
 * Note: the brand card (🃏), the 收龙 dragon (🐉) and the win taiji (☯) stay
 * colour emoji — they're decorative showpieces where the colour render beats
 * a monochrome glyph; only the small toolbar/badge controls use lucide.
 */
import {
    Hourglass,
    Lightbulb,
    Volume2,
    VolumeX,
} from 'lucide-vue-next';
import { computed } from 'vue';

export type GlyphIconName =
  | 'hint'
  | 'hourglass'
  | 'sound'
  | 'muted';

const props = withDefaults(
  defineProps<{
    name: GlyphIconName;
    /** Render size in CSS px (square). */
    size?: number;
  }>(),
  { size: 20 },
);

const icon = computed(() => {
  switch (props.name) {
    case 'hint':
      return Lightbulb;
    case 'hourglass':
      return Hourglass;
    case 'sound':
      return Volume2;
    case 'muted':
      return VolumeX;
  }
});
</script>

<template>
  <component
    :is="icon"
    :size="props.size"
    :stroke-width="1.8"
    aria-hidden="true"
  />
</template>
