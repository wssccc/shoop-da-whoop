// shared/utils/common.js
// 通用纯函数工具库 —— 与具体游戏无关，无 DOM / 副作用。
//
// 引用方式（相对各自游戏页面）：
//   import { rand, shuffle, clamp } from '../../shared/utils/common.js';

/** 返回 [min, max] 区间的整数随机数（含端点）。 */
export function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Fisher–Yates 原地洗牌，返回原数组。 */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 节流：首次立即执行，随后在 wait ms 内最多触发一次（含尾部调用）。 */
export function throttle(fn, wait = 100) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn.apply(null, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(null, args);
      }, remaining);
    }
  };
}

/** 防抖：延迟 wait ms 后执行，期间再次调用则重置计时。 */
export function debounce(fn, wait = 100) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(null, args), wait);
  };
}

/** 将 value 限制在 [min, max] 区间。 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** 生成简易唯一 id（非加密强度）。 */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
