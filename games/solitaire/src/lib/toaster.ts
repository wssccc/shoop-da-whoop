// Minimal command-style toast store on top of reka-ui's declarative Toast
// primitives (ToastProvider / ToastRoot / ToastViewport — see Toaster.vue).
//
// reka-ui 2.x has no built-in `toast()` helper; this mirrors the shadcn-vue
// toaster pattern: a module-level store + imperative `toast()` + a single
// <Toaster/> mounted in App.vue.
//
// Semantics (agreed with the user):
//   * achievement toasts: pushable, may stack, auto-dismiss after 3200ms.
//   * hint toasts: same fixed id (`hint`) — pushing a new hint REPLACES the
//     previous one immediately (the new toast still plays its enter
//     animation; the replaced one cuts off, matching "single hint" semantics).

import { ref } from 'vue';

export interface ToastItem {
  /** Reka-ui v-for key. Pass a fixed id to replace an existing toast. */
  key: string;
  title: string;
  duration: number;
}

const TOAST_MS = 3200;

const items = ref<ToastItem[]>([]);
let seq = 0;

export function toast(opts: { title: string; duration?: number; id?: string }): void {
  const key = opts.id ?? `t${++seq}`;
  // Replace-by-id: drop any previous toast with the same key so only the
  // newest message with that key is visible (hint single-toast semantics).
  items.value = items.value.filter((t) => t.key !== key);
  items.value.push({
    key,
    title: opts.title,
    duration: opts.duration ?? TOAST_MS,
  });
}

export function dismissToast(key: string): void {
  items.value = items.value.filter((t) => t.key !== key);
}

/** Read-only snapshot for <Toaster/>. */
export function useToastStore() {
  return { items, dismissToast };
}
