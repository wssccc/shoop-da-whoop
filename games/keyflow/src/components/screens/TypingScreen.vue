<script setup lang="ts">
import { computed, inject, nextTick, onMounted, ref, watch } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { useTypingSession } from '../../composables/useTypingSession';
import { fingerText, lessonKeys } from '../../game/constants';
import KeyboardGraphic from '../KeyboardGraphic.vue';

const api = inject(KeyFlowKey)!;
const session = api.session.value!;
const isInitialTest = session.kind === 'initial';
const isKeypad = session.title === 'Keypad Lesson' || session.title === 'Keypad Test';
const { lineIdx, posInLine, typed, currentLine, total, msg, wpm, acc, isComplete, pendingError, progressPct } =
  useTypingSession(session.lines, (r) => {
    if (isInitialTest) api.completeInitialTest(r);
    else api.completeSession(r, session.title, session.kind);
  });

/** 当前课程键集（键盘图高亮）。 */
const lessonKeysStr = computed(() => {
  const ki = api.profile.value?.currentKeyIndex ?? 0;
  return isKeypad ? '4567891230.+' : lessonKeys(ki);
});
/** 焦点键（键盘图高亮 + 指法提示行）。 */
const focusKey = computed(() => api.focusKey.value ?? '');
const fingerHint = computed(() => (focusKey.value ? fingerText(focusKey.value) : ''));

/** 首行指令框（第一个 drill 显示指令，之后显示实时统计）。 */
const showInstruction = computed(() => lineIdx.value === 0);

/** 上方引导行分段：done（已通过）/ current（当前字符）/ err（打错的那一格）。
 *  打错时 posInLine 已前进（打错不卡住），所以错误标记落在 posInLine - 1，
 *  与下方输入行红显的位置保持一致。 */
const guideSegments = computed(() => {
  const line = currentLine.value;
  const out: { ch: string; cls: string }[] = [];
  for (let i = 0; i < line.length; i++) {
    let cls = '';
    if (i < posInLine.value) cls = i === posInLine.value - 1 && pendingError.value ? 'err' : 'done';
    else if (i === posInLine.value) cls = 'current';
    out.push({ ch: line[i], cls });
  }
  return out;
});

/** 下方实际输入行分段：整行宽度（未输入部分空格占位），与引导行逐字符对齐。
 *  已输入字符显示实际按键（错误红显），空格显示为 ·。 */
const typedSegments = computed(() => {
  const line = currentLine.value;
  const out: { ch: string; cls: string }[] = [];
  for (let i = 0; i < line.length; i++) {
    const t = typed.value[i];
    if (t) {
      out.push({ ch: t.ch === ' ' ? '·' : t.ch, cls: t.err ? 'err' : 'typed' });
    } else {
      out.push({ ch: ' ', cls: 'empty' });
    }
  }
  return out;
});

const guideEl = ref<HTMLElement | null>(null);
const typedEl = ref<HTMLElement | null>(null);
const pointer = ref({ left: 16, top: 24 });
/** 输入行闪烁块光标（指示当前输入位置）。 */
const blinkBlock = ref({ left: 0, top: 0, width: 0, height: 0, visible: false });

/** 基于引导行字符 span 的实际 DOM 位置对齐指针（折行后依然准确）。 */
function updatePointer() {
  nextTick(() => {
    const nodes = guideEl.value?.children;
    if (!nodes) return;
    const chars = Array.from(nodes).filter(
      (n) => !n.classList.contains('lesson-pointer'),
    ) as HTMLElement[];
    if (chars.length === 0) return;
    const idx = posInLine.value;
    const cur = chars[idx];
    const target = cur ?? chars[chars.length - 1];
    const left = cur ? target.offsetLeft : target.offsetLeft + target.offsetWidth;
    pointer.value = { left, top: target.offsetTop + target.offsetHeight + 2 };
    // 输入行闪烁块：定位到第 posInLine 个字符（整行占位，与引导行对齐）
    const typedNodes = typedEl.value?.children;
    if (typedNodes) {
      const tChars = Array.from(typedNodes).filter(
        (n) => !n.classList.contains('blink-block'),
      ) as HTMLElement[];
      const tCur = tChars[idx];
      if (tCur) {
        blinkBlock.value = {
          left: tCur.offsetLeft,
          top: tCur.offsetTop,
          width: tCur.offsetWidth,
          height: tCur.offsetHeight,
          visible: true,
        };
      } else {
        blinkBlock.value.visible = false;
      }
    }
  });
}

onMounted(updatePointer);
watch([posInLine, lineIdx, pendingError], updatePointer);
</script>

<template>
  <div class="panel wide typing-panel">
    <h2>{{ session.title }}</h2>
    <div class="line-indicator">Line {{ lineIdx + 1 }}/{{ session.lines.length }}</div>
    <div class="lesson-box">
      <div ref="guideEl" class="lesson-text">
        <span v-for="(seg, i) in guideSegments" :key="i" :class="seg.cls">{{ seg.ch }}</span>
        <span v-if="!isComplete" class="lesson-pointer" :style="{ left: pointer.left + 'px', top: pointer.top + 'px' }">▲</span>
      </div>
      <div ref="typedEl" class="typed-line" aria-label="Your typing">
        <span v-for="(seg, i) in typedSegments" :key="i" :class="seg.cls">{{ seg.ch }}</span>
        <span v-if="blinkBlock.visible" class="blink-block" :style="{ left: blinkBlock.left + 'px', top: blinkBlock.top + 'px', width: blinkBlock.width + 'px', height: blinkBlock.height + 'px' }"></span>
      </div>
    </div>
    <p v-if="fingerHint" class="finger-hint">{{ fingerHint }}</p>
    <KeyboardGraphic :keys="lessonKeysStr" :highlight="focusKey" />
    <div v-if="showInstruction" class="instruction-box">
      Type the line above. The marker tracks the next key, a wrong key shows in red and the
      lesson carries on. The next line starts as soon as this one is finished.
    </div>
    <div v-else class="stats-row">
      <span>Speed: {{ wpm }} WPM</span>
      <span>Accuracy: {{ acc }}%</span>
      <span>Keys: {{ total }}</span>
    </div>
    <div class="progress-row">
      <div
        class="progress"
        role="progressbar"
        aria-label="Typing progress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progressPct"
      >
        <div class="progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>
      <span class="progress-label">{{ progressPct }}%</span>
    </div>
    <div class="lesson-msg">{{ msg }}</div>
    <p class="hint">Esc - finish the session</p>
  </div>
</template>
