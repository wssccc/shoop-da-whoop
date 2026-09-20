<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';

const api = inject(KeyFlowKey)!;
function onKey() {
  window.removeEventListener('keydown', onKey);
  api.start();
}
onMounted(() => window.addEventListener('keydown', onKey, { once: true }));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="boot-box">
    <h1 class="title">KeyFlow</h1>
    <p class="subtitle">Typing Trainer</p>
    <p class="copyright">Typing trainer · Accurate practice · Progress tracking<br>Pure static web app, data stays on your device</p>
    <p class="press">Any key starts the program.</p>
  </div>
</template>
