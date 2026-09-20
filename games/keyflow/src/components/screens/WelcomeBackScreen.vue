<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { welcomeMessage } from '../../game/student';

const api = inject(KeyFlowKey)!;
const s = api.profile.value!;
const paras = welcomeMessage(s);

function continueToMenu() {
  api.go('mainMenu');
}

function onKey(e: KeyboardEvent) {
  e.preventDefault();
  continueToMenu();
}

// Registered once, but also removed on unmount: clicking "Continue" must not
// leave a stray listener that hijacks the next keypress (see docs/design.md §6.2).
onMounted(() => window.addEventListener('keydown', onKey, { once: true }));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="panel wide">
    <h2>Welcome Back</h2>
    <div class="scroll-text">
      <p v-for="(p, i) in paras" :key="i">{{ p }}</p>
    </div>
    <div class="btn-row">
      <button class="btn" @click="continueToMenu">Continue</button>
    </div>
    <p class="hint">Any key opens the Main Menu</p>
  </div>
</template>