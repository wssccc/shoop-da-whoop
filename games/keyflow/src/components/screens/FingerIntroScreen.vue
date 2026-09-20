<script setup lang="ts">
import { inject } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import KeyboardGraphic from '../KeyboardGraphic.vue';

const api = inject(KeyFlowKey)!;
</script>

<template>
  <div class="panel wide">
    <h2>Finger Positioning</h2>
    <div class="scroll-text">
      <p>
        Home row first: the left hand covers A S D F (little, ring, middle, index), the right
        hand covers J K L ; (index, middle, ring, little).
      </p>
      <p>
        Keep them there and stretch to the other keys. Hover a key below to see which finger
        takes it.
      </p>
    </div>
    <KeyboardGraphic show-finger />
    <div class="btn-row">
      <button class="btn" @click="api.go('lessonsMenu')">Back to Lessons</button>
      <button class="btn" @click="api.go('mainMenu')">Back to Main Menu</button>
    </div>
  </div>
</template>