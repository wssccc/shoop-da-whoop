<script setup lang="ts">
import { inject, ref } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { INTRO_PAGES } from '../../game/constants';

const api = inject(KeyFlowKey)!;
const page = ref(0);

function next() {
  page.value++;
  if (page.value >= INTRO_PAGES.length) api.go('initialTest');
}
function skip() {
  api.go('initialTest');
}
function paras() {
  return INTRO_PAGES[page.value].split('\n').filter(Boolean).map(p => p.replace(/ /g, '\u00a0'));
}
</script>

<template>
  <div class="panel wide">
    <h2>Introduction</h2>
    <div class="scroll-text">
      <p v-for="(p, i) in paras()" :key="i">{{ p }}</p>
    </div>
    <div class="btn-row">
      <button class="btn" @click="skip">Skip introduction</button>
      <button class="btn" @click="next">Next</button>
    </div>
  </div>
</template>
