<script setup lang="ts">
import { computed, inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { LESSONS, lessonDesc, lessonName } from '../../game/constants';
import KeyFlowMenu from '../KeyFlowMenu.vue';

const api = inject(KeyFlowKey)!;

/** 菜单项：当前顺序课程（严格顺序，只能练当前课）+ 特殊课程。 */
const items = computed(() => {
  const ki = api.profile.value?.currentKeyIndex ?? 0;
  return [lessonName(ki), ...LESSONS.map(l => l.name)];
});
const descs = computed(() => {
  const ki = api.profile.value?.currentKeyIndex ?? 0;
  return [lessonDesc(ki), ...LESSONS.map(l => l.desc)];
});

function onSelect(i: number) {
  if (i === 0) { api.startLesson(); return; }
  const lesson = LESSONS[i - 1];
  api.startSpecialLesson(lesson.kind);
}
</script>

<template>
  <div class="panel">
    <h2>Practice Lesson</h2>
    <KeyFlowMenu :items="items" :descs="descs" @select="onSelect" @cancel="api.back()" />
    <p class="hint">Move with ↑ / ↓ (or W / S), choose with Enter (or Space)</p>
  </div>
</template>
