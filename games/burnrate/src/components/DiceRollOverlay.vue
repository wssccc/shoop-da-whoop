<script setup lang="ts">
/**
 * DiceRollOverlay — 开局掷骰定先手（3D 立方体骰子）。
 *
 * 结果由引擎 `rollFirst()` 预掷并通过 `outcome` prop 传入（含全部平局重掷
 * 轮次），本组件只把动画演出到既定结果：逐轮滚动（仅并列者重掷）→ 停定 →
 * 高亮先手 → emit('done')。因此「⏩ 快进」只是把演出快进到最终结果，结果
 * 本身不变；✕ 取消则完全放弃本次开局（去向由父层决定）。
 *
 * 3D 落面：每个面值映射到唯一朝向（1 正 / 2 上 / 3 右 / 4 左 / 5 下 / 6 背），
 * 从随机起始角补间到「目标角 + 随机整圈余量」，easeOut 落定；整圈余量为
 * 360° 的倍数，不改变最终朝面，只增加翻滚的戏剧感。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Audio } from '@burnrate/composables/useAudio';
import { sideName } from '@burnrate/game/state';
import type { DiceRollOutcome, PlayerId } from '@burnrate/game/types';

const props = defineProps<{ outcome: DiceRollOutcome }>();
const emit = defineEmits<{
  (e: 'done', winner: PlayerId): void;
  (e: 'cancel'): void;
}>();

const playerCount = computed(() => props.outcome.rounds[0]?.players.length ?? 2);
const players = computed(() => Array.from({ length: playerCount.value }, (_, i) => i));
const winner = computed(() => props.outcome.winner);

/** 3×3 pip grid, row-major 0..8 → lit pips per face value. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Face value → cube orientation that brings that face to the front. */
const FACE_ROT: Record<number, { rx: number; ry: number }> = {
  1: { rx: 0, ry: 0 },
  2: { rx: -90, ry: 0 },
  3: { rx: 0, ry: -90 },
  4: { rx: 0, ry: 90 },
  5: { rx: 90, ry: 0 },
  6: { rx: 0, ry: 180 },
};

interface DieState {
  value: number;
  rot: { rx: number; ry: number };
  rolling: boolean;
  winner: boolean;
}

/** One die per player, starting from a random orientation (tumbling start). */
const dice = ref<DieState[]>(
  Array.from({ length: playerCount.value }, () => ({
    value: 0,
    rot: { rx: Math.random() * 720 - 360, ry: Math.random() * 720 - 360 },
    rolling: false,
    winner: false,
  })),
);

const revealed = ref(false);
const skipFlag = ref(false);

const dieEls: (HTMLElement | null)[] = [];
function setDieRef(i: number, el: unknown): void {
  dieEls[i] = el as HTMLElement | null;
}

// ---- animation plumbing --------------------------------------------------

let disposed = false;
const timers: number[] = [];
const rafIds: number[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((r) => {
    if (skipFlag.value || disposed) {
      r();
      return;
    }
    timers.push(window.setTimeout(r, ms));
  });
}

function toCss(rot: { rx: number; ry: number }): string {
  return `rotateX(${rot.rx}deg) rotateY(${rot.ry}deg)`;
}

/** Tween one die from its current rotation to `target` (easeOut cubic).
 *  Skipping snaps it straight to the target — same final face, no waiting. */
function tweenTo(i: number, target: { rx: number; ry: number }, duration: number): Promise<void> {
  return new Promise((resolve) => {
    const el = dieEls[i];
    const from = { ...dice.value[i].rot };
    const start = performance.now();
    const tick = (now: number) => {
      if (skipFlag.value || disposed) {
        dice.value[i].rot = { ...target };
        if (el) el.style.transform = toCss(target);
        resolve();
        return;
      }
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      dice.value[i].rot = {
        rx: from.rx + (target.rx - from.rx) * e,
        ry: from.ry + (target.ry - from.ry) * e,
      };
      if (el) el.style.transform = toCss(dice.value[i].rot);
      if (t < 1) rafIds[i] = requestAnimationFrame(tick);
      else resolve();
    };
    rafIds[i] = requestAnimationFrame(tick);
  });
}

/** Target orientation = face orientation + 2-3 extra full turns (varied). */
function targetRot(value: number): { rx: number; ry: number } {
  const base = FACE_ROT[value];
  const spins = 2 + Math.floor(Math.random() * 2);
  return {
    rx: base.rx + (Math.random() < 0.4 ? spins * 360 : 0),
    ry: base.ry + spins * 360,
  };
}

// ---- orchestration -------------------------------------------------------

async function play(): Promise<void> {
  Audio.diceRoll();
  await delay(150);
  const rounds = props.outcome.rounds;
  for (let r = 0; r < rounds.length; r++) {
    if (disposed) return;
    const round = rounds[r];
    round.players.forEach((p) => {
      dice.value[p].rolling = true;
    });
    // Everyone in this round rolls, staggered so they land one after another.
    await Promise.all(
      round.players.map((p, k) =>
        (async () => {
          await delay(k * 140);
          if (disposed) return;
          if (r > 0) Audio.diceRoll();
          const target = targetRot(round.values[k]);
          await tweenTo(p, target, 1500);
          if (disposed) return;
          dice.value[p].value = round.values[k];
          dice.value[p].rolling = false;
        })(),
      ),
    );
    if (disposed) return;
    if (r < rounds.length - 1) await delay(500);
  }
  if (disposed) return;
  // Reveal the winner.
  dice.value[props.outcome.winner].winner = true;
  revealed.value = true;
  Audio.diceReveal();
  await delay(950);
  if (disposed) return;
  emit('done', props.outcome.winner);
}

/** 快进：把所有骰子直接定格到最终结果并立即揭晓（结果不变）。 */
function skip(): void {
  if (revealed.value) return;
  skipFlag.value = true;
}

onMounted(() => {
  play();
});
onBeforeUnmount(() => {
  disposed = true;
  timers.forEach((id) => clearTimeout(id));
  timers.length = 0;
  rafIds.forEach((id) => cancelAnimationFrame(id));
  rafIds.length = 0;
});
</script>

<template>
  <div class="dice-overlay">
    <div class="dice-card">
      <button type="button" class="dice-close" title="取消开局" @click="emit('cancel')">✕</button>

      <div class="dice-title">🎲 掷骰决定先手</div>
      <div class="dice-sub">点数最高者先手 · 并列最高者重掷</div>

      <div class="dice-row">
        <div
          v-for="p in players"
          :key="p"
          class="die-col"
          :class="{ 'is-winner': dice[p].winner }"
        >
          <div class="die-name">{{ sideName(p) }}</div>
          <div class="die-scene">
            <div
              class="die"
              :ref="(el) => setDieRef(p, el)"
            >
              <div
                v-for="v in [1, 2, 3, 4, 5, 6]"
                :key="v"
                class="face"
                :class="'face-' + v"
              >
                <span
                  v-for="k in 9"
                  :key="k"
                  class="pip"
                  :class="{ on: PIPS[v].includes(k - 1) }"
                ></span>
              </div>
            </div>
            <div v-if="dice[p].winner" class="winner-ring"></div>
          </div>
          <div class="die-value" :class="{ rolling: dice[p].rolling }">
            {{ dice[p].value || '·' }}
          </div>
        </div>
      </div>

      <div class="dice-reveal" :class="{ show: revealed }">
        <template v-if="revealed">🏆 先手：{{ sideName(winner) }}</template>
      </div>

      <div class="dice-actions">
        <button type="button" class="btn btn-secondary" :disabled="revealed" @click="skip">
          ⏩ 快进
        </button>
        <span class="dice-hint">结果已定 · 快进只跳过动画</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dice-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(8, 8, 20, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dice-card {
  background: #16162e;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 26px 34px 20px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6);
  text-align: center;
  position: relative;
  animation: diceIn 0.22s ease;
  max-width: 92vw;
}
@keyframes diceIn {
  from { opacity: 0; transform: scale(0.92) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.dice-close {
  position: absolute;
  top: 10px;
  right: 12px;
  background: none;
  border: none;
  color: #5a5a78;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  font-family: inherit;
}
.dice-close:hover { color: #e8e8f5; background: rgba(255, 255, 255, 0.06); }
.dice-title { font-size: 18px; font-weight: 700; color: #e8e8f5; }
.dice-sub { font-size: 12px; color: #5a5a78; margin: 6px 0 22px; }

.dice-row {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 28px;
}
.die-col { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.die-name { font-size: 12px; font-weight: 600; color: #8a8aa8; }
.die-col.is-winner .die-name { color: #ffb454; }
.die-scene {
  width: 84px;
  height: 84px;
  perspective: 520px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.die {
  position: relative;
  width: 64px;
  height: 64px;
  transform-style: preserve-3d;
  will-change: transform;
}
.face {
  position: absolute;
  inset: 0;
  background: #f2efe6;
  border-radius: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  padding: 9px;
  backface-visibility: hidden;
}
.pip {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #23233a;
  margin: auto;
  opacity: 0;
  transition: opacity 0.15s;
}
.pip.on { opacity: 1; }
.face-1 { transform: rotateY(0deg) translateZ(32px); }
.face-2 { transform: rotateX(90deg) translateZ(32px); }
.face-3 { transform: rotateY(90deg) translateZ(32px); }
.face-4 { transform: rotateY(-90deg) translateZ(32px); }
.face-5 { transform: rotateX(-90deg) translateZ(32px); }
.face-6 { transform: rotateY(180deg) translateZ(32px); }

.winner-ring {
  position: absolute;
  inset: -11px;
  border-radius: 20px;
  border: 2px solid #ffb454;
  box-shadow: 0 0 26px rgba(255, 180, 84, 0.55);
  animation: ringPulse 0.8s ease-in-out infinite alternate;
  pointer-events: none;
}
@keyframes ringPulse {
  from { box-shadow: 0 0 10px rgba(255, 180, 84, 0.3); }
  to { box-shadow: 0 0 30px rgba(255, 180, 84, 0.75); }
}

.die-value {
  font-size: 13px;
  font-weight: 700;
  color: #5a5a78;
  min-height: 18px;
  min-width: 18px;
}
.die-value.rolling { color: #13ddc4; }
.die-col.is-winner .die-value { color: #ffb454; }

.dice-reveal {
  margin-top: 20px;
  min-height: 22px;
  font-size: 16px;
  font-weight: 700;
  color: #ffb454;
  opacity: 0;
  transition: opacity 0.25s;
}
.dice-reveal.show { opacity: 1; }

.dice-actions {
  margin-top: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.dice-actions .btn { width: auto; padding: 7px 18px; }
.dice-hint { font-size: 11px; color: #4a4a66; }
</style>
