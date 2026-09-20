<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 98.css 窗口式模态对话框 —— 替代原生 confirm()。
 * Esc 关闭（取消），确认按钮自动聚焦，aria-modal 语义化。
 */
const props = defineProps<{
  title: string;
  message: string;
  confirm?: string;
  cancel?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const confirmBtn = ref<HTMLButtonElement | null>(null);

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('cancel');
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  confirmBtn.value?.focus();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="modal-overlay" role="presentation">
    <div class="window modal-window" role="dialog" aria-modal="true" :aria-label="props.title">
      <div class="title-bar">
        <div class="title-bar-text">{{ props.title }}</div>
        <div class="title-bar-controls">
          <button aria-label="Close" @click="emit('cancel')"></button>
        </div>
      </div>
      <div class="window-body modal-body">
        <p>{{ props.message }}</p>
        <div class="field-row">
          <button ref="confirmBtn" type="button" class="btn" @click="emit('confirm')">
            {{ props.confirm ?? 'OK' }}
          </button>
          <button type="button" class="btn" @click="emit('cancel')">
            {{ props.cancel ?? 'Cancel' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
