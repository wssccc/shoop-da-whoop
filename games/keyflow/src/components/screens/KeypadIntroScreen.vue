<script setup lang="ts">
import { inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import KeyboardGraphic from '../KeyboardGraphic.vue';

const api = inject(KeyFlowKey)!;
</script>

<template>
  <div class="panel wide">
    <h2>Keypad Lesson</h2>
    <div class="scroll-text">
      <p>
        The keypad is typed with your right hand. Rest three fingers on 4, 5 and 6 -
        index finger on 4, middle finger on 5, ring finger on 6. Every other number
        and symbol is reached from there.
      </p>
    </div>
    <KeyboardGraphic keypad />
    <div class="btn-row">
      <button class="btn" @click="api.beginKeypadLesson()">Begin lesson</button>
      <button class="btn" @click="api.back()">Back</button>
    </div>
  </div>
</template>