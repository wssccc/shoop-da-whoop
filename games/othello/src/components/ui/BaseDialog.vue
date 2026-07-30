<script setup lang="ts">
/**
 * BaseDialog — minimal self-contained dialog using Teleport + Transition.
 *
 * Features:
 *  - Overlay click-to-close
 *  - Escape key-to-close
 *  - Smooth fade + scale transition
 *  - Title slot + default body slot
 *  - X close button in header
 *
 * Usage:
 *   <BaseDialog v-model:open="showDialog" title="标题">
 *     <p>内容</p>
 *   </BaseDialog>
 */

import { watch, onUnmounted } from 'vue';
import { X } from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
  title?: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

function close() {
  emit('update:open', false);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}

// Add/remove global Escape listener when dialog opens/closes
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      window.addEventListener('keydown', onKeydown);
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  },
);

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        <!-- Overlay -->
        <div
          class="absolute inset-0 bg-black/50"
          @click="close"
        />

        <!-- Content panel -->
        <div
          class="relative z-10 mx-4 w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800 p-6 text-white shadow-xl"
        >
          <!-- Header -->
          <div
            v-if="title"
            class="mb-4 flex items-center justify-between"
          >
            <h2 class="text-lg font-semibold">{{ title }}</h2>
            <button
              class="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
              @click="close"
            >
              <X class="size-4" />
            </button>
          </div>

          <!-- Body -->
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
