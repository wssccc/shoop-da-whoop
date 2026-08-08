<script setup lang="ts">
/**
 * Toaster — single reka-ui Toast mount point for Solitaire.
 *
 * Renders the provider (global 3.2s duration) + viewport (positioned by the
 * existing `.toasts` CSS) + one <ToastRoot> per store item. Enter/exit
 * animations run off reka-ui's `data-state` attribute (see index.css) —
 * the closed state is kept mounted until the exit animation finishes.
 */
import { useToastStore } from '@solitaire/lib/toaster';
import {
    ToastProvider,
    ToastRoot,
    ToastTitle,
    ToastViewport,
} from 'reka-ui';

const { items, dismissToast } = useToastStore();
</script>

<template>
  <ToastProvider :duration="3200">
    <ToastViewport class="toasts">
      <ToastRoot
        v-for="t in items"
        :key="t.key"
        class="toast"
        :duration="t.duration"
        @close="dismissToast(t.key)"
      >
        <ToastTitle class="toast-title">{{ t.title }}</ToastTitle>
      </ToastRoot>
    </ToastViewport>
  </ToastProvider>
</template>
