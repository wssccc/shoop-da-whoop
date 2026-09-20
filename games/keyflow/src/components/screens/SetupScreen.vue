<script setup lang="ts">
import { inject, onMounted, ref } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import type { Experience } from '../../game/types';

const api = inject(KeyFlowKey)!;
const isEdit = api.setupMode.value === 'edit';
const name = ref('');
const date = ref('');
const experience = ref<Experience>('beginner');
const error = ref('');
const nameEl = ref<HTMLInputElement | null>(null);

/** 注册向导经验水平选项。 */
const EXPERIENCES: { id: Experience; label: string }[] = [
  { id: 'beginner', label: 'Beginner' },
  { id: 'two-finger', label: 'Two finger typist' },
  { id: 'touch', label: 'Touch typist' },
];

onMounted(() => {
  if (isEdit && api.profile.value) {
    name.value = api.profile.value.name;
    date.value = api.profile.value.date;
    experience.value = api.profile.value.experience;
  } else {
    name.value = '';
    date.value = api.today();
    experience.value = 'beginner';
  }
  nameEl.value?.focus();
});

function onOk() {
  const err = isEdit
    ? api.editProfile(name.value, date.value)
    : api.setupProfile(name.value, date.value, experience.value);
  if (err) { error.value = err; return; }
  api.go(isEdit ? 'optionsMenu' : 'intro');
}
function onBack() {
  api.go(isEdit ? 'optionsMenu' : 'boot');
}
</script>

<template>
  <div class="panel">
    <h2>{{ isEdit ? 'Edit profile' : 'Profile Setup' }}</h2>
    <form class="setup-form" @submit.prevent="onOk">
      <label class="hint" for="kf-name">Your name</label>
      <input ref="nameEl" id="kf-name" v-model="name" type="text" maxlength="39" autocomplete="off" />
      <label class="hint" for="kf-date">Today's date (MM-DD-YY)</label>
      <input id="kf-date" v-model="date" type="text" maxlength="8" placeholder="MM-DD-YY" autocomplete="off" />
      <template v-if="!isEdit">
        <span class="hint">Which of these describes your typing background best?</span>
        <div class="exp-row" role="radiogroup" aria-label="Experience">
          <label v-for="e in EXPERIENCES" :key="e.id" class="exp-option">
            <input v-model="experience" type="radio" name="kf-exp" :value="e.id" />
            {{ e.label }}
          </label>
        </div>
      </template>
      <p class="error" role="alert">{{ error }}</p>
      <!-- 按钮必须在 <form> 内：type="submit" 的 OK 才能与输入框 Enter 键等价；
           移到表单外会失去隐式提交（含两个文本框时 Enter 不再提交）。 -->
      <div class="btn-row">
        <button class="btn" type="submit">OK</button>
        <button class="btn" type="button" @click="onBack">Back</button>
      </div>
    </form>
  </div>
</template>
