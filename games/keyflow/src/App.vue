<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, type Component } from 'vue';
import BootScreen from './components/screens/BootScreen.vue';
import FingerIntroScreen from './components/screens/FingerIntroScreen.vue';
import HelpScreen from './components/screens/HelpScreen.vue';
import InitialTestScreen from './components/screens/InitialTestScreen.vue';
import IntroScreen from './components/screens/IntroScreen.vue';
import KeypadIntroScreen from './components/screens/KeypadIntroScreen.vue';
import LessonsMenuScreen from './components/screens/LessonsMenuScreen.vue';
import MainMenuScreen from './components/screens/MainMenuScreen.vue';
import NewKeyIntroScreen from './components/screens/NewKeyIntroScreen.vue';
import NumberInputScreen from './components/screens/NumberInputScreen.vue';
import OptionsMenuScreen from './components/screens/OptionsMenuScreen.vue';
import ReportScreen from './components/screens/ReportScreen.vue';
import ReportsMenuScreen from './components/screens/ReportsMenuScreen.vue';
import SetupScreen from './components/screens/SetupScreen.vue';
import ShiftIntroScreen from './components/screens/ShiftIntroScreen.vue';
import SummaryScreen from './components/screens/SummaryScreen.vue';
import TestsMenuScreen from './components/screens/TestsMenuScreen.vue';
import TypingScreen from './components/screens/TypingScreen.vue';
import WelcomeBackScreen from './components/screens/WelcomeBackScreen.vue';
import { KeyFlowKey, useKeyFlow } from './composables/useKeyFlow';
import type { ViewName } from './game/types';

const api = useKeyFlow();
provide(KeyFlowKey, api);

const screens: Record<ViewName, Component> = {
  boot: BootScreen,
  setup: SetupScreen,
  intro: IntroScreen,
  initialTest: InitialTestScreen,
  typing: TypingScreen,
  summary: SummaryScreen,
  mainMenu: MainMenuScreen,
  lessonsMenu: LessonsMenuScreen,
  testsMenu: TestsMenuScreen,
  reportsMenu: ReportsMenuScreen,
  optionsMenu: OptionsMenuScreen,
  input: NumberInputScreen,
  report: ReportScreen,
  newKeyIntro: NewKeyIntroScreen,
  shiftIntro: ShiftIntroScreen,
  fingerIntro: FingerIntroScreen,
  help: HelpScreen,
  welcomeBack: WelcomeBackScreen,
  keypadIntro: KeypadIntroScreen,
};

const SCREEN_TITLES: Record<ViewName, string> = {
  boot: 'KeyFlow',
  setup: 'Profile Setup',
  intro: 'Introduction',
  initialTest: 'Initial Test',
  typing: 'Typing Session',
  summary: 'Lesson Summary',
  mainMenu: 'Main Menu',
  lessonsMenu: 'Practice Lesson',
  testsMenu: 'Practice Test',
  reportsMenu: 'Reports',
  optionsMenu: 'Options',
  input: 'Settings',
  report: 'Report',
  newKeyIntro: 'New Key',
  shiftIntro: 'Uppercase',
  fingerIntro: 'Finger Positioning',
  help: 'Help',
  welcomeBack: 'Welcome Back',
  keypadIntro: 'Keypad Lesson',
};

/** 窗口标题：KeyFlow — 当前屏名。 */
const windowTitle = computed(() => `KeyFlow — ${SCREEN_TITLES[api.view.value]}`);

/** 工具栏是否显示：boot（启动界面）/ typing（Esc 语义完整）/ input（弹层）不显示。 */
const showToolbar = computed(() => !['boot', 'typing', 'input'].includes(api.view.value));

function onGlobalKey(e: KeyboardEvent) {
  if (!e.altKey) return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    api.back();
  } else if (e.key === 'Home') {
    e.preventDefault();
    api.goMainMenu();
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));
</script>

<template>
  <div class="desktop">
    <div class="keyflow-root">
      <div class="window keyflow-window">
        <div class="title-bar">
          <div class="title-bar-text">{{ windowTitle }}</div>
          <div class="title-bar-controls">
            <button aria-label="Minimize" disabled></button>
            <button aria-label="Maximize" disabled></button>
            <button aria-label="Close" disabled></button>
          </div>
        </div>
        <div v-if="showToolbar" class="toolbar" role="toolbar" aria-label="Navigation">
          <button
            type="button"
            class="btn"
            :disabled="api.view.value === 'mainMenu'"
            @click="api.back()"
            title="Back (Alt+Left)"
          >
            ◀ Back
          </button>
          <button
            type="button"
            class="btn"
            :disabled="api.view.value === 'mainMenu'"
            @click="api.goMainMenu()"
            title="Main Menu (Alt+Home)"
          >
            ⌂ Main Menu
          </button>
        </div>
        <div class="window-body">
          <div class="screen">
            <Transition name="screen">
              <component :is="screens[api.view.value]" :key="api.view.value" />
            </Transition>
          </div>
        </div>
      </div>
    </div>
    <Transition name="toast">
      <div v-if="api.notice.value" class="toast" role="status" aria-live="polite">{{ api.notice.value }}</div>
    </Transition>
  </div>
</template>
