<script setup lang="ts">
import { inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { INITIAL_TEST_TEXT } from '../../game/constants';

const api = inject(KeyFlowKey)!;

function start() {
  api.startSession('Initial Test', [INITIAL_TEST_TEXT], 'initial');
}
function skip() {
  api.skipInitialTest();
}
</script>

<template>
  <div class="panel wide">
    <h2>Initial Test</h2>
    <p class="hint">A short first test is enough for KeyFlow to set your starting lesson and goals.</p>
    <div class="btn-row">
      <button class="btn" @click="start">Begin test</button>
      <button class="btn" @click="skip">Skip</button>
    </div>
  </div>
</template>
