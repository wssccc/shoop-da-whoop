<script setup lang="ts">
import { computed, ref } from 'vue';
import { FINGER_ATTR, fingerText } from '../game/constants';

/**
 * 简化键盘图 —— 高亮课程键集，特别高亮新键；可选悬停显示指法。
 * keypad 模式显示数字小键盘布局（4 5 6 / 7 8 9 / 1 2 3 0 . +）。
 * 用于 NewKeyIntro / FingerIntro / ShiftIntro / KeypadIntro / Typing 屏。
 */
const props = defineProps<{
  /** 高亮键集（课程键，小写） */
  keys?: string;
  /** 特别高亮键（新键/焦点键） */
  highlight?: string;
  /** 悬停显示指法说明 */
  showFinger?: boolean;
  /** keypad 布局 */
  keypad?: boolean;
}>();

const QWERTY_ROWS: string[][] = [
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']', '\\'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ';', "'"],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/'],
];
const KEYPAD_ROWS: string[][] = [
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['1', '2', '3', '0', '.', '+'],
];

const ROWS = computed(() => (props.keypad ? KEYPAD_ROWS : QWERTY_ROWS));

const fingerInfo = ref('');

function isInKeys(k: string): boolean {
  return !!props.keys && props.keys.includes(k);
}
function onHover(k: string) {
  if (!props.showFinger) return;
  fingerInfo.value = fingerText(k);
}
/** 无障碍标签：读出「键位 + 手指」而非 60 多个裸字符。 */
function keyLabel(k: string): string {
  const attr = FINGER_ATTR[k];
  return attr ? `${k} key, ${attr.hand} ${attr.finger} finger` : `${k} key`;
}
</script>

<template>
  <div
    class="kb-wrap"
    role="group"
    :aria-label="keypad ? 'Numeric keypad diagram' : 'Keyboard diagram'"
  >
    <div class="kb-row" v-for="(row, ri) in ROWS" :key="ri">
      <button
        v-for="k in row"
        :key="k"
        type="button"
        class="kb-key"
        :class="{
          inkeys: isInKeys(k),
          newkey: k === highlight,
        }"
        :tabindex="showFinger ? 0 : -1"
        :aria-label="keyLabel(k)"
        @mouseenter="onHover(k)"
        @focus="onHover(k)"
      >
        {{ k }}
      </button>
    </div>
    <p v-if="showFinger && fingerInfo" class="kb-finger" role="status">{{ fingerInfo }}</p>
  </div>
</template>

<style scoped>
.kb-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  margin: 8px 0;
}
.kb-row {
  display: flex;
  gap: 3px;
}
.kb-key {
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  font-family: var(--font-monospace, monospace);
  font-size: 12px;
  line-height: 1;
  text-align: center;
  background: #c0c0c0;
  border: 1px solid #808080;
  border-top-color: #fff;
  border-left-color: #fff;
  box-shadow: 1px 1px 0 #404040;
  cursor: default;
}
.kb-key.inkeys {
  background: #ffffcc;
  border-color: #808000;
}
.kb-key.newkey {
  background: #ffcccc;
  border-color: #c00000;
  font-weight: bold;
}
.kb-finger {
  margin: 6px 0 0;
  min-height: 1.2em;
  text-align: center;
}
</style>