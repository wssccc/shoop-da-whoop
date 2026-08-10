// Thin Vue shell over the howler-backed SFX singleton (see src/lib/audio.ts).
//
// This composable only adds the iOS-friendly auto-resume wiring: VueUse's
// useDocumentVisibility drives a resume() whenever the tab becomes visible
// again (iOS Safari suspends the AudioContext in the background and does not
// auto-restore it — see memories/ios-webaudio-suspended-leak.md). Call once
// from App setup; all other call sites use the `Audio` singleton directly.

import {
  Audio,
  getMuted,
  loadAll,
  setMuted,
  type AudioApi,
} from '@solitaire/lib/audio';
import { useDocumentVisibility } from '@vueuse/core';
import { watch } from 'vue';

export { Audio, getMuted, setMuted };
export type { AudioApi };

export function useAudio(): AudioApi {
  loadAll(); // kick off preloading of every SFX (8 tiny mp3s, ~45 KB total)
  const visibility = useDocumentVisibility();
  watch(
    visibility,
    (v) => {
      if (v === 'visible') Audio.resume();
    },
    { flush: 'post' },
  );
  // Lock-screen hole: iOS suspends the AudioContext on lock/backgrounding but
  // keeps the page "visible", so the visibility watcher above never fires.
  // Cover the real return paths: bfcache restore (pageshow), window focus
  // (unlock), and the user's first tap/click (pointerdown) — all cheap
  // no-ops while the context is already running.
  window.addEventListener('pageshow', () => Audio.resume());
  window.addEventListener('focus', () => Audio.resume());
  document.addEventListener('pointerdown', () => Audio.resume(), { passive: true });
  return Audio;
}
