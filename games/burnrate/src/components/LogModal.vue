<script setup lang="ts">
/**
 * LogModal — 📜 战报弹窗（替代旧 LogView）：按轮标记的全部战况记录。
 */
import { computed } from 'vue';
import type { BurnRateGameApi } from '@burnrate/composables/useBurnRateGame';

const props = defineProps<{ game: BurnRateGameApi; open: boolean }>();

const emit = defineEmits<{ (e: 'close'): void }>();

const s = computed(() => props.game.state.value);
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card" style="width: 520px;">
      <button type="button" class="modal-close" @click="emit('close')">✕</button>
      <div class="modal-header">
        <div class="modal-icon" style="background: rgba(140,130,255,0.12);">📜</div>
        <div>
          <div class="modal-title">战报</div>
          <div class="modal-type">共 {{ s.log.length }} 条记录 · AI 回合的每一步都会记录在这里</div>
        </div>
      </div>
      <div class="modal-scroll">
        <div v-if="s.log.length === 0" class="log-list">
          <div class="empty-hint">📭 暂无战报</div>
        </div>
        <div v-else class="log-list">
          <div v-for="(entry, i) in s.log" :key="`${i}-${entry.msg}`" class="log-entry" :class="entry.type">
            <span class="log-round">R{{ s.turn }}</span>{{ entry.msg }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.empty-hint { color: #5a5a78; font-size: 12px; text-align: center; padding: 24px 0; }
</style>
