<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 通用列表菜单 —— 键盘优先（↑/↓/w/s 移动、Enter/空格 选择、Esc 取消）
 * + 鼠标点击/悬停。菜单项为真 <button role="menuitem">，支持 Tab 焦点
 * 导航与可见 focus（键盘+鼠标双通道）。
 *
 * `disabled`：宿主屏幕弹出模态（BaseModal）时必须置真 —— 菜单自身不卸载，
 * 若不吃掉键盘事件，Enter/Esc/方向键会穿透遮罩去操作被遮住的菜单项。
 */
const props = defineProps<{ items: string[]; descs?: string[]; disabled?: boolean }>();
const emit = defineEmits<{ select: [index: number]; cancel: [] }>();

const sel = ref(0);

function move(delta: number) {
  const n = props.items.length;
  if (n === 0) return;
  sel.value = (sel.value + delta + n) % n;
}

function onKey(e: KeyboardEvent) {
  if (props.disabled) return;
  switch (e.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      e.preventDefault();
      move(-1);
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      e.preventDefault();
      move(1);
      break;
    case 'Enter':
    case ' ':
      e.preventDefault();
      emit('select', sel.value);
      break;
    case 'Escape':
      e.preventDefault();
      emit('cancel');
      break;
  }
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div>
    <div class="menu" role="menu" aria-label="Menu">
      <button
        v-for="(it, i) in items"
        :key="i"
        type="button"
        class="menu-item"
        :class="{ selected: i === sel }"
        role="menuitem"
        :tabindex="props.disabled || i !== sel ? -1 : 0"
        @mouseenter="sel = i"
        @focus="sel = i"
        @click="emit('select', i)"
      >
        {{ it }}
      </button>
    </div>
    <p v-if="descs && descs[sel]" class="menu-desc">{{ descs[sel] }}</p>
  </div>
</template>
