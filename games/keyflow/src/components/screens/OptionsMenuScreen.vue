<script setup lang="ts">
import { inject, ref } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { DRILL_CHOICES, OPT_DESCS, OPT_ITEMS } from '../../game/constants';
import BaseModal from '../BaseModal.vue';
import KeyFlowMenu from '../KeyFlowMenu.vue';

const api = inject(KeyFlowKey)!;
const showReset = ref(false);
const notice = api.notice;

function onSelect(i: number) {
  const s = api.profile.value;
  if (!s) { api.go('mainMenu'); return; }
  switch (i) {
    case 0:
      api.openInput({
        title: 'Change speed goal',
        prompt: 'Enter new speed goal (WPM):',
        value: String(s.speedGoal),
        min: 10, max: 150,
        onSubmit: (v) => { api.setSpeedGoal(parseInt(v, 10)); api.notify(`Speed goal set to ${v} WPM`); api.go('optionsMenu'); },
        onCancel: () => api.go('optionsMenu'),
      });
      break;
    case 1:
      api.openInput({
        title: 'Adjust practice goal',
        prompt: 'Enter weekly practice goal (minutes):',
        value: String(s.practiceGoal),
        min: 10, max: 600,
        onSubmit: (v) => { api.setPracticeGoal(parseInt(v, 10)); api.go('optionsMenu'); },
        onCancel: () => api.go('optionsMenu'),
      });
      break;
    case 2:
      api.openInput({
        title: 'Change accuracy goal',
        prompt: 'Enter target accuracy (%):',
        value: String(s.accuracyGoal),
        min: 50, max: 100,
        onSubmit: (v) => { api.setAccuracyGoal(parseInt(v, 10)); api.go('optionsMenu'); },
        onCancel: () => api.go('optionsMenu'),
      });
      break;
    case 3:
      api.openInput({
        title: 'Change number of drills',
        prompt: `Enter drills per lesson (${DRILL_CHOICES.join('/')}):`,
        value: String(s.drills),
        min: 5, max: 20,
        onSubmit: (v) => { api.setDrills(parseInt(v, 10)); api.go('optionsMenu'); },
        onCancel: () => api.go('optionsMenu'),
      });
      break;
    case 4: api.openSetup('edit'); break;
    case 5: showReset.value = true; break;
    case 6: api.retakeInitialTest(); break;
    case 7: api.reviewIntro(); break;
  }
}
</script>

<template>
  <div class="panel">
    <h2>Options Menu</h2>
    <KeyFlowMenu
      :items="OPT_ITEMS"
      :descs="OPT_DESCS"
      :disabled="showReset"
      @select="onSelect"
      @cancel="api.back()"
    />
    <p class="hint">Move with ↑ / ↓ (or W / S), choose with Enter (or Space)</p>
    <p v-if="notice" class="lesson-msg">{{ notice }}</p>
    <BaseModal
      v-if="showReset"
      title="Reset profile"
      message="This will erase all typing history and goals. Are you sure?"
      confirm="Reset"
      @confirm="api.resetProfile()"
      @cancel="showReset = false"
    />
  </div>
</template>
