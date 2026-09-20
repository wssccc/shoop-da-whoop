<script setup lang="ts">
import { inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import KeyFlowMenu from '../KeyFlowMenu.vue';

const api = inject(KeyFlowKey)!;
/** Practice Test 用当前课程键集动态生成（摘要屏入口）；All-keys 用固定文本，Keypad 用生成器。 */
const items = ['Practice Test', 'All-keys Test', 'Keypad Test'];
const descs = [
  'Test on the current lesson keys',
  'Test on all keys',
  'Test on the numeric keypad',
];

function onSelect(i: number) {
  api.startTest(i === 0 ? 'practice' : i === 1 ? 'all' : 'keypad');
}
</script>

<template>
  <div class="panel">
    <h2>Practice Test</h2>
    <KeyFlowMenu :items="items" :descs="descs" @select="onSelect" @cancel="api.back()" />
    <p class="hint">Move with ↑ / ↓ (or W / S), choose with Enter (or Space)</p>
  </div>
</template>
