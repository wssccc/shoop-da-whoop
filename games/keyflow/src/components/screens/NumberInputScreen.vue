<script setup lang="ts">
import { inject, onMounted, ref } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';

const api = inject(KeyFlowKey)!;
const cfg = api.inputConfig.value!;
const value = ref(cfg.value);
const inputEl = ref<HTMLInputElement | null>(null);

function ok() {
  if (cfg.min != null || cfg.max != null) {
    const v = parseInt(value.value, 10);
    const lo = cfg.min ?? -Infinity;
    const hi = cfg.max ?? Infinity;
    if (isNaN(v) || v < lo || v > hi) {
      api.notify(`Please enter a value between ${cfg.min} and ${cfg.max}`);
      return;
    }
    cfg.onSubmit(String(v));
  } else {
    cfg.onSubmit(value.value);
  }
}
function cancel() {
  cfg.onCancel();
}

onMounted(() => inputEl.value?.focus());
</script>

<template>
  <div class="modal-overlay" role="presentation">
    <div class="window modal-window" role="dialog" aria-modal="true" :aria-label="cfg.title">
      <div class="title-bar">
        <div class="title-bar-text">{{ cfg.title }}</div>
        <div class="title-bar-controls">
          <button aria-label="Close" @click="cancel"></button>
        </div>
      </div>
      <div class="window-body modal-body">
        <form @submit.prevent="ok">
          <label class="hint" :for="'kf-input-' + cfg.title">{{ cfg.prompt }}</label>
          <input
            ref="inputEl"
            v-model="value"
            :id="'kf-input-' + cfg.title"
            :type="cfg.type ?? 'text'"
            autocomplete="off"
            :maxlength="cfg.type === 'text' ? 39 : undefined"
          />
          <div class="field-row">
            <button class="btn" type="submit">OK</button>
            <button class="btn" type="button" @click="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
