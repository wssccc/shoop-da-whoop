<script setup lang="ts">
/**
 * BaseBadge — minimal CVA-styled badge (copied from solitaire / othello).
 */
import { cva, type VariantProps } from 'class-variance-authority';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type BadgeVariant = VariantProps<typeof badgeVariants>;

const props = defineProps<{
  variant?: BadgeVariant['variant'];
  class?: string;
}>();
</script>

<template>
  <span :class="badgeVariants({ variant: props.variant, class: props.class })">
    <slot />
  </span>
</template>
