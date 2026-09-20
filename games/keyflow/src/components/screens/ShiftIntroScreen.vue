<script setup lang="ts">
import { computed, inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { UPPERCASE_FROM, lessonKeys } from '../../game/constants';
import KeyboardGraphic from '../KeyboardGraphic.vue';

const api = inject(KeyFlowKey)!;
/** 高亮当前课程键集（不在组件里硬编码 26 字母，避免与 LESSON_KEY_ORDER 分叉）。 */
const keys = computed(() => lessonKeys(api.profile.value?.currentKeyIndex ?? UPPERCASE_FROM));
</script>

<template>
  <div class="panel wide">
    <h2>Uppercase Lesson</h2>
    <div class="scroll-text">
      <p>
        Until now every lesson stayed on lower case letters. From here on some letters appear
        as capitals, which means holding Shift while you type them.
      </p>
      <p>
        There is a Shift key on each side of the keyboard. Hold the one on the opposite side to
        the letter, using that hand's little finger.
      </p>
      <p>
        The capital 'E', for example, is the right Shift (right little finger) together with E
        (left middle finger).
      </p>
    </div>
    <KeyboardGraphic :keys="keys" />
    <div class="btn-row">
      <button class="btn" @click="api.beginAfterIntro()">Begin lesson</button>
      <button class="btn" @click="api.go('mainMenu')">Back to Main Menu</button>
    </div>
  </div>
</template>