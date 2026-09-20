<script setup lang="ts">
import { inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { MAIN_DESCS, MAIN_ITEMS } from '../../game/constants';
import KeyFlowMenu from '../KeyFlowMenu.vue';

const api = inject(KeyFlowKey)!;

function onSelect(i: number) {
  switch (i) {
    case 0: api.go('lessonsMenu'); break;
    case 1: api.go('testsMenu'); break;
    case 2: api.go('reportsMenu'); break;
    case 3: api.go('optionsMenu'); break;
    case 4: api.go('help'); break;
    case 5: api.exit(); break;
  }
}
</script>

<template>
  <div class="panel">
    <h2>Main Menu</h2>
    <KeyFlowMenu :items="MAIN_ITEMS" :descs="MAIN_DESCS" @select="onSelect" @cancel="api.exit()" />
    <p class="hint">Move with ↑ / ↓ (or W / S), choose with Enter (or Space)</p>
  </div>
</template>
