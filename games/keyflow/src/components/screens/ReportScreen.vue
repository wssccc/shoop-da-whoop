<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue';
import { KeyFlowKey } from '../../composables/useKeyFlow';
import { drawSessionChart } from '../../composables/useSessionChart';
import { keyClassBreakdown } from '../../game/lesson';
import { weekMinutes } from '../../game/student';

const api = inject(KeyFlowKey)!;
const kind = api.reportKind.value;
const s = api.profile.value;
const canvasRef = ref<HTMLCanvasElement | null>(null);

const title = computed(() => {
  switch (kind) {
    case 'speed': return 'Speed Report';
    case 'acc': return 'Accuracy Report';
    default: return 'Progress Report';
  }
});

/** 会话历史统计（Speed/Accuracy Report：平均/最后/最大/目标）。 */
const sessionStats = computed(() => {
  const log = s!.sessionLog;
  const values = log.map((e) => (kind === 'speed' ? e.wpm : e.acc));
  const last = values.length > 0 ? values[values.length - 1] : 0;
  const max = values.length > 0 ? Math.max(...values) : 0;
  const avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const goal = kind === 'speed' ? s!.speedGoal : s!.accuracyGoal;
  return { avg, last, max, goal };
});

/** Progress Report 键类 Breakdown（速度分组）。 */
const breakdown = computed(() => keyClassBreakdown(s!.keyStats));

const rows = computed(() => {
  const cur = s!;
  if (kind === 'progress') {
    return [
      { k: 'Student', v: cur.name },
      { k: 'Last practice', v: cur.date || '—' },
      { k: 'Current Speed', v: `${cur.wpm} WPM` },
      { k: 'Accuracy', v: `${cur.acc}%` },
      { k: 'Speed Goal', v: `${cur.speedGoal} WPM` },
      { k: 'Practice Goal', v: `${cur.practiceGoal} min/week` },
      { k: 'This Week', v: `${Math.round(weekMinutes(cur))} min` },
      { k: 'Accuracy Goal', v: `${cur.accuracyGoal}%` },
      { k: 'Total Practice', v: `${Math.round(cur.totalMin)} min` },
      { k: 'Weeks Practiced', v: `${cur.totalWeeks || 1}` },
    ];
  }
  const st = sessionStats.value;
  return [
    { k: 'Average', v: `${st.avg} ${kind === 'speed' ? 'WPM' : '%'}` },
    { k: 'Last', v: `${st.last} ${kind === 'speed' ? 'WPM' : '%'}` },
    { k: 'Max', v: `${st.max} ${kind === 'speed' ? 'WPM' : '%'}` },
    { k: kind === 'speed' ? 'Speed Goal' : 'Accuracy Goal', v: `${st.goal} ${kind === 'speed' ? 'WPM' : '%'}` },
  ];
});

/** 会话历史列表（最近 10 条，倒序）。 */
const recentLog = computed(() => s!.sessionLog.slice(-10).reverse());

const showChart = kind === 'speed' || kind === 'acc';

function draw() {
  if (showChart && canvasRef.value && s) {
    drawSessionChart(canvasRef.value, kind as 'speed' | 'acc', s.sessionLog, sessionStats.value.goal);
  }
}

onMounted(() => {
  draw();
  canvasRef.value?.focus?.();
});

function back() {
  api.go('reportsMenu');
}
</script>

<template>
  <div class="panel wide">
    <h2>{{ title }}</h2>
    <div class="report-body">
      <div v-for="r in rows" :key="r.k" class="row">
        <span>{{ r.k }}</span><span class="val">{{ r.v }}</span>
      </div>
    </div>
    <div v-if="kind === 'progress'" class="report-body">
      <div class="row"><span>Keys Above 15 WPM</span><span class="val">{{ breakdown.keysAbove }}</span></div>
      <div class="row"><span>Letter Speed</span><span class="val">{{ breakdown.letter }} WPM</span></div>
      <div class="row"><span>Number Speed</span><span class="val">{{ breakdown.number }} WPM</span></div>
      <div class="row"><span>Symbol Speed</span><span class="val">{{ breakdown.symbol }} WPM</span></div>
    </div>
    <canvas v-if="showChart" ref="canvasRef" id="report-chart" width="640" height="220"></canvas>
    <div v-if="showChart && recentLog.length > 0" class="log-list">
      <h3>Session history</h3>
      <table class="log-table">
        <thead>
          <tr><th>Date</th><th>Kind</th><th>WPM</th><th>Acc</th><th>Min</th></tr>
        </thead>
        <tbody>
          <tr v-for="(e, i) in recentLog" :key="i">
            <td>{{ e.date }}</td>
            <td>{{ e.kind }}</td>
            <td>{{ e.wpm }}</td>
            <td>{{ e.acc }}%</td>
            <td>{{ Math.round(e.minutes) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="btn-row">
      <button class="btn" @click="back">Return</button>
    </div>
  </div>
</template>
