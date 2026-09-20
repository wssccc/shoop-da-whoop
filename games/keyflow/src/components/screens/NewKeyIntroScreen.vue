<script setup lang="ts">
import { computed, inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { fingerText, lessonKeys } from '../../game/constants';
import KeyboardGraphic from '../KeyboardGraphic.vue';

const api = inject(KeyFlowKey)!;
const info = api.newKeyInfo.value!;
const keys = lessonKeys(info.lesson - 1);
const text = computed(() => fingerText(info.key));
</script>

<template>
  <div class="panel wide">
    <h2>New Key Introduction</h2>
    <p class="hint">
      Next up: a new key joins your lesson - '{{ info.key }}'.
    </p>
    <p class="lesson-msg">{{ text }}</p>
    <KeyboardGraphic :keys="keys" :highlight="info.key" />
    <p class="hint">
      Keep your fingers anchored on the home row and stretch from there to reach the rest of
      the keyboard.
    </p>
    <div class="btn-row">
      <button class="btn" @click="api.beginAfterIntro()">Begin lesson {{ info.lesson }}</button>
      <button class="btn" @click="api.go('mainMenu')">Back to Main Menu</button>
    </div>
  </div>
</template>