import type { SessionLogEntry } from '../game/types';

/** 图表逻辑高度（CSS px）；宽度取容器宽度。 */
const CHART_H = 220;
/** backing store 倍率上限（2 已覆盖主流 HiDPI，更高只增内存）。 */
const MAX_DPR = 2;

/**
 * 按会话柱状图（每会话一根柱，最多 ~40 根，Y 轴刻度 + 目标线）。
 * speed 模式蓝柱 + 速度目标线；acc 模式绿柱 + 准确率目标线。
 *
 * HiDPI：backing store 按 `devicePixelRatio` 放大（上限 2），绘制坐标仍用 CSS px
 * （`setTransform` 统一缩放），否则在 Retina/iOS 上图表与刻度文字发糊。
 */
export function drawSessionChart(
  canvas: HTMLCanvasElement,
  kind: 'speed' | 'acc',
  log: SessionLogEntry[],
  goal: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(
    MAX_DPR,
    (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
  );
  const W = canvas.clientWidth || canvas.width || 640;
  const H = CHART_H;
  const storeW = Math.round(W * dpr);
  const storeH = Math.round(H * dpr);
  if (canvas.width !== storeW || canvas.height !== storeH) {
    canvas.width = storeW;
    canvas.height = storeH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const sessions = log.slice(-40);
  const values = sessions.map((e) => (kind === 'speed' ? e.wpm : e.acc));
  const max = Math.max(goal, ...values, 1);
  const padL = 36;
  const padB = 22;
  const padT = 10;
  const padR = 10;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // 网格 + Y 轴刻度
  ctx.strokeStyle = '#c0c0c0';
  ctx.fillStyle = '#000';
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.fillText(String(Math.round((max * g) / 4)), 2, y + 3);
  }

  // 目标线
  if (goal > 0) {
    const y = padT + plotH - (plotH * goal) / max;
    ctx.strokeStyle = '#c00';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#c00';
    ctx.fillText(`goal ${goal}`, padL + 2, y - 3);
  }

  // 柱
  const n = sessions.length;
  if (n === 0) {
    ctx.fillStyle = '#000';
    ctx.fillText('No sessions yet', padL, padT + plotH / 2);
    return;
  }
  const bw = Math.min(14, (plotW / n) * 0.7);
  const step = plotW / n;
  sessions.forEach((e, i) => {
    const v = kind === 'speed' ? e.wpm : e.acc;
    const h = (plotH * v) / max;
    const x = padL + i * step + (step - bw) / 2;
    const y = padT + plotH - h;
    ctx.fillStyle = kind === 'speed' ? '#000080' : '#008000';
    ctx.fillRect(x, y, bw, Math.max(1, h));
    // 值标签（每 5 根标一个，避免拥挤）
    if (i % 5 === 0 || i === n - 1) {
      ctx.fillStyle = '#000';
      ctx.fillText(String(v), x, y - 2);
    }
  });

  // X 轴标签
  ctx.fillStyle = '#000';
  ctx.fillText('sessions', padL, H - 6);
}