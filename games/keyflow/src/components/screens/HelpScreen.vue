<script setup lang="ts">
import { inject, ref } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { HELP_PAGES } from '../../game/constants';

const api = inject(KeyFlowKey)!;
const page = ref(0);

function next() {
  if (page.value + 1 < HELP_PAGES.length) {
    page.value++;
  } else {
    api.back();
  }
}
function paras() {
  return HELP_PAGES[page.value].split('\n').filter(Boolean).map(p => p.replace(/ /g, '\u00a0'));
}
</script>

<template>
  <div class="panel wide">
    <h2>Help</h2>
    <div class="scroll-text">
      <p v-for="(p, i) in paras()" :key="i">{{ p }}</p>
    </div>
    <div class="btn-row">
      <button class="btn" @click="api.back()">Back</button>
      <button class="btn" @click="next">{{ page + 1 < HELP_PAGES.length ? 'Next' : 'Done' }}</button>
    </div>
  </div>
</template>