<script setup lang="ts">
/**
 * ResultOverlay — 结算弹窗（burn-rate.html .result-overlay 风格）：
 * mode = 'win'（玩家获胜）/ 'bankrupt-gate'（破产，选择观战或退出）/
 * 'spectate-end'（观战结束）/ 'game-over'（未获胜的普通结束）。
 */
import { computed } from 'vue';
import type { BurnRateGameApi } from '@burnrate/composables/useBurnRateGame';

const props = defineProps<{
  game: BurnRateGameApi;
  mode: 'win' | 'bankrupt-gate' | 'spectate-end' | 'game-over';
}>();

const emit = defineEmits<{ (e: 'newGame'): void; (e: 'backMenu'): void }>();

const s = computed(() => props.game.state.value);
const winnerName = computed(() => {
  const w = s.value.winner;
  return w === null ? '' : props.game.state.value.players[w]?.alive ? `对手${w}` : `AI ${w}`;
});

const display = computed(() => {
  switch (props.mode) {
    case 'win':
      return { emoji: '🏆', title: '你赢了！', msg: '所有对手现金耗尽，你笑到了最后！' };
    case 'bankrupt-gate':
      return { emoji: '💀', title: '你的公司破产了', msg: '现金烧尽，你已出局。剩余 AI 将继续对决，要观战吗？' };
    case 'spectate-end':
      return { emoji: '📺', title: '观战结束', msg: `最终赢家：${winnerName.value}。观战结束。` };
    case 'game-over':
      return { emoji: '🤝', title: '对局结束', msg: `最终赢家：${winnerName.value}。再来一局复仇吧！` };
  }
});
</script>

<template>
  <div class="full-overlay">
    <div class="result-card">
      <div class="result-emoji">{{ display.emoji }}</div>
      <h2>{{ display.title }}</h2>
      <p>{{ display.msg }}</p>
      <div class="result-actions">
        <button
          v-if="mode === 'bankrupt-gate'"
          type="button"
          class="start-btn"
          @click="game.startSpectate()"
        >🎬 观战剩余 AI</button>
        <button v-else type="button" class="start-btn" @click="emit('newGame')">⟳ 再来一局</button>
        <button type="button" class="start-btn ghost" @click="emit('backMenu')">✕ 返回菜单</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-card {
  width: 380px; background: #16162e; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px; padding: 28px; text-align: center;
  animation: modalIn 0.2s ease;
}
@keyframes modalIn { from { opacity: 0; transform: scale(0.92) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
.result-emoji { font-size: 48px; margin-bottom: 10px; }
.result-card h2 { font-size: 20px; color: #e8e8f5; margin-bottom: 6px; }
.result-card p { font-size: 13px; color: #8a8aa8; margin-bottom: 20px; line-height: 1.6; }
.result-actions { display: flex; flex-direction: column; gap: 8px; }
.start-btn {
  width: 100%; padding: 11px; border-radius: 10px; border: none;
  background: linear-gradient(135deg, #13DDC4, #2EA7FF); color: #fff;
  font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.2s;
}
.start-btn:hover { box-shadow: 0 4px 20px rgba(19,221,196,0.3); transform: translateY(-1px); }
.start-btn.ghost {
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  color: #b8b8d0;
}
.start-btn.ghost:hover { background: rgba(255,255,255,0.09); color: #e8e8f5; }
</style>
