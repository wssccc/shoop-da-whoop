import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { analyzeKeys, computeAccuracy, computeWpm } from '../game/lesson';
import type { SessionResult } from '../game/types';

/**
 * 打字会话运行时 —— 按行推进（整行完成才切下一行，参考语义）。
 * 在 TypingScreen 中调用一次；持有的 lineIdx/posInLine/errors/total 均为响应式，
 * 统计与"已完成/当前/错误"片段随按键由 Vue 派生（不再整段 innerHTML）。
 * onMounted 注册 window keydown，onUnmounted 移除（结构化防泄漏）。
 *
 * 交互语义：
 * - 打错不卡住：错误字符记录到 typed（err 标记），pos 前进，可继续输入；
 *   Backspace 回退重打（不撤销已记录统计，防刷分）；
 * - 每键增量（keyDeltas）驱动频率表与每键统计；
 * - WPM 用参考公式 (correct+errors-2×lines)/5/min；
 * - typed 记录当前行实际输入（供下方"实际输入行"显示，与引导行逐字符对齐）。
 */
export function useTypingSession(
  lines: string[],
  onDone: (r: SessionResult) => void,
) {
  const lineIdx = ref(0);
  const posInLine = ref(0);
  const errors = ref(0);
  const total = ref(0);
  const msg = ref('');
  const finished = ref(false);
  /** 当前期望字符是否因输错而标红（仅 UI 标记，统计已记录）。 */
  const pendingError = ref(false);
  /** 当前打错的字符（错误提示用）。 */
  const pendingChar = ref('');
  const now = ref(performance.now());
  const startTime = performance.now();
  /** 当前行实际输入（err=true 表示打错，红显）。长度恒等于 posInLine，与引导行对齐。 */
  const typed = ref<{ ch: string; err: boolean }[]>([]);
  /** 每键增量（correct/errors），会话结束交给引擎层。 */
  const keyDeltas: Record<string, { correct: number; errors: number }> = {};
  /** 最后一行完成后的 300 ms 收尾窗口：期间忽略按键，
   *  否则多按的键会以 `expected === undefined` 被记成错误。 */
  const finishing = ref(false);

  let doneTimer: ReturnType<typeof setTimeout> | null = null;

  const currentLine = computed(() => lines[lineIdx.value] ?? '');
  const completedChars = computed(() =>
    lines.slice(0, lineIdx.value).reduce((a, l) => a + l.length, 0),
  );
  const totalChars = computed(() => lines.reduce((a, l) => a + l.length, 0));
  const elapsedMs = computed(() => now.value - startTime);
  const correct = computed(() => total.value - errors.value);
  const wpm = computed(() => computeWpm(correct.value, errors.value, lines.length, elapsedMs.value));
  const acc = computed(() => computeAccuracy(correct.value, errors.value));
  const isComplete = computed(() => lineIdx.value >= lines.length);
  const progressPct = computed(() =>
    totalChars.value > 0
      ? Math.round(((completedChars.value + posInLine.value) / totalChars.value) * 100)
      : 0,
  );

  function recordKey(ch: string, ok: boolean) {
    const d = keyDeltas[ch] ?? { correct: 0, errors: 0 };
    if (ok) d.correct++;
    else d.errors++;
    keyDeltas[ch] = d;
  }

  /** 当前行完成 → 切下一行；最后一行 → 结束。 */
  function advanceLine() {
    if (lineIdx.value + 1 >= lines.length) {
      msg.value = 'Lesson complete!';
      finishing.value = true;
      doneTimer = setTimeout(finish, 300);
    } else {
      lineIdx.value++;
      posInLine.value = 0;
      typed.value = [];
      pendingError.value = false;
      pendingChar.value = '';
      msg.value = '';
    }
  }

  function finish() {
    if (finished.value) return;
    finished.value = true;
    now.value = performance.now();
    const elapsed = now.value - startTime;
    const mins = Math.max(0.1, elapsed / 60000);
    const stats = analyzeKeys(keyDeltas, elapsed);
    onDone({
      wpm: computeWpm(correct.value, errors.value, lines.length, elapsed),
      acc: computeAccuracy(correct.value, errors.value),
      minutes: mins,
      total: total.value,
      correct: correct.value,
      errors: errors.value,
      lines: lines.length,
      bestKeys: stats.bestKeys,
      weakKeys: stats.weakKeys,
      keysAbove: stats.keysAbove,
      keyDeltas,
    });
  }

  function onKey(e: KeyboardEvent) {
    if (finished.value) return;
    const k = e.key;
    if (k === 'Escape') { finish(); return; }
    if (finishing.value) return; // 收尾窗口：忽略多按的键

    // Backspace：回退当前行内指针（清 UI 标红），不撤销已记录的统计（参考语义）。
    if (k === 'Backspace') {
      e.preventDefault();
      pendingError.value = false;
      pendingChar.value = '';
      if (posInLine.value > 0) {
        posInLine.value--;
        typed.value.pop();
      }
      msg.value = '';
      now.value = performance.now();
      return;
    }

    if (k.length !== 1) return;
    e.preventDefault();
    if (isComplete.value) { finish(); return; }
    total.value++;
    now.value = performance.now();
    const expected = currentLine.value[posInLine.value];
    if (k === expected) {
      recordKey(expected, true);
      typed.value.push({ ch: k, err: false });
      posInLine.value++;
      pendingError.value = false;
      pendingChar.value = '';
      if (msg.value) msg.value = '';
    } else {
      // 打错不卡住：记录错误字符，pos 前进，可继续输入。
      recordKey(expected, false);
      errors.value++;
      typed.value.push({ ch: k, err: true });
      posInLine.value++;
      pendingError.value = true;
      pendingChar.value = k;
      msg.value = `Incorrect: expected '${expected}', got '${k}'`;
    }
    if (posInLine.value >= currentLine.value.length) {
      advanceLine();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onKey);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    if (doneTimer) clearTimeout(doneTimer);
  });

  return {
    lineIdx,
    posInLine,
    typed,
    pendingChar,
    currentLine,
    errors,
    total,
    msg,
    wpm,
    acc,
    isComplete,
    pendingError,
    progressPct,
    finish,
  };
}
