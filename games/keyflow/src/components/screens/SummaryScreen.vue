<script setup lang="ts">
import { computed, inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { LESSON_KEY_ORDER, MASTER_WPM } from '../../game/constants';
import { masteredSet } from '../../game/lesson';

const api = inject(KeyFlowKey)!;
const result = api.summaryValue()!;
const title = api.summaryTitle();
const focus = api.focusKey.value;

/** 全部键掌握 → End of Lesson 横幅。 */
const allMastered = computed(() => {
  const ks = api.profile.value?.keyStats;
  return ks ? masteredSet(ks).size >= LESSON_KEY_ORDER.length : false;
});
const header = computed(() => (allMastered.value ? 'End of Lesson' : 'Keyboard Lesson Summary'));

/** Keyboard Lesson Summary：Lesson / Speed / Accuracy / Keys Above N /
 *  Best Keys / Keys to Work on / Current Focus Keys。 */
const rows = computed(() => [
  ['Lesson', title],
  ['Speed', `${result.wpm} WPM`],
  ['Accuracy', `${result.acc}%`],
  ['Keys Above ' + MASTER_WPM + ' WPM', String(result.keysAbove)],
  ['Best Keys', result.bestKeys || '—'],
  ['Keys to Work on', result.weakKeys || '—'],
  ['Current Focus Keys', focus || '—'],
]);

function continueLessons() {
  api.continueLessons();
}
function takeTest() {
  api.takeTest();
}
function backMenu() {
  api.endLesson();
}
</script>

<template>
  <div class="panel">
    <h2>{{ header }}</h2>
    <div class="summary-body">
      <div v-for="[k, v] in rows" :key="k" class="row">
        <span>{{ k }}</span><span class="val">{{ v }}</span>
      </div>
    </div>
    <div class="btn-row">
      <button class="btn" @click="continueLessons">Continue lessons</button>
      <button class="btn" @click="takeTest">Practice test</button>
      <button class="btn" @click="backMenu">End of Lesson</button>
    </div>
  </div>
</template>
