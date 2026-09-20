<script setup lang="ts">
import { inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import KeyFlowMenu from '../KeyFlowMenu.vue';

const api = inject(KeyFlowKey)!;
const items = ['Progress', 'Speed', 'Accuracy', 'Help'];
const descs = [
  'Show current speed, accuracy and key breakdown',
  'Speed report: average, last, max and session history',
  'Accuracy report: average, last, max and session history',
  'How the reports and charts work',
];

function onSelect(i: number) {
  if (i === 3) { api.go('help'); return; }
  api.openReport(i === 1 ? 'speed' : i === 2 ? 'acc' : 'progress');
}
</script>

<template>
  <div class="panel">
    <h2>Reports</h2>
    <KeyFlowMenu :items="items" :descs="descs" @select="onSelect" @cancel="api.back()" />
    <p class="hint">Move with ↑ / ↓ (or W / S), choose with Enter (or Space)</p>
  </div>
</template>
