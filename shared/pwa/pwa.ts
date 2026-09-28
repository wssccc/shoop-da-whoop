// PWA service-worker registration + non-blocking update banner.
//
// Loaded by every entry (home + 6 games) so any page registers the same
// root-scoped service worker and can surface "new version" prompts. The
// banner is deliberately framework-free and dependency-free: the games use
// three different UI stacks and none of them owns a shared toast/dialog
// component.
//
// Update flow (registerType: 'prompt' in vite.config.js):
//   * a new SW installs in the background and enters the waiting state;
//   * the banner invites the player to reload whenever convenient;
//   * only tapping "更新" activates the new SW and reloads the page — an
//     ongoing game is never reloaded under the player's hands.
//
// Every step is wrapped in try/catch on purpose: a broken PWA wrapper must
// never take a whole game down with it.

/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';

const BANNER_ID = 'sdw-pwa-banner';
const STYLE_ID = 'sdw-pwa-banner-style';

// NOTE: this CSS is injected at runtime, so it never passes through
// PostCSS preset-env. Stick to properties iOS 13 already understands
// (no `inset`, no flex `gap`, plain physical sides).
const BANNER_CSS = `
.sdw-pwa-banner {
  position: fixed;
  left: 50%;
  bottom: 16px;
  /* Fallback first: engines without env() keep the plain 16px. */
  bottom: calc(16px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  max-width: calc(100vw - 24px);
  padding: 10px 12px;
  border-radius: 10px;
  background: #1c1c22;
  color: #f5f5f5;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}
.sdw-pwa-banner-text {
  margin-right: 10px;
  white-space: nowrap;
}
.sdw-pwa-banner-update {
  margin-right: 6px;
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: #39ff14;
  color: #0b0b0f;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.sdw-pwa-banner-update[disabled] {
  opacity: 0.6;
  cursor: default;
}
.sdw-pwa-banner-dismiss {
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #b9b9c0;
  font: inherit;
  cursor: pointer;
}
`;

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

function injectBannerStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = BANNER_CSS;
  document.head.appendChild(style);
}

function showUpdateBanner(): void {
  if (document.getElementById(BANNER_ID)) return; // already showing
  injectBannerStyle();

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.className = 'sdw-pwa-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML =
    '<span class="sdw-pwa-banner-text">发现新版本</span>' +
    '<button type="button" class="sdw-pwa-banner-update">更新</button>' +
    '<button type="button" class="sdw-pwa-banner-dismiss" aria-label="稍后再说">×</button>';
  document.body.appendChild(banner);

  const updateButton = banner.querySelector('.sdw-pwa-banner-update');
  const dismissButton = banner.querySelector('.sdw-pwa-banner-dismiss');

  if (updateButton) {
    updateButton.addEventListener('click', () => {
      updateButton.setAttribute('disabled', '');
      if (updateSW) {
        void updateSW(true);
      } else {
        window.location.reload();
      }
    });
  }
  if (dismissButton) {
    dismissButton.addEventListener('click', () => {
      banner.remove();
    });
  }
}

try {
  updateSW = registerSW({
    onNeedRefresh() {
      showUpdateBanner();
    },
    onOfflineReady() {
      // Precache finished: the whole site works offline from now on.
      // Silent on purpose — nothing for the player to do.
    },
    onRegisterError(error: unknown) {
      // Unsupported browser / blocked storage: stay online-only, never
      // break the page over it.
      console.warn('[pwa] service worker registration failed:', error);
    },
  });
} catch (error) {
  console.warn('[pwa] service worker setup failed:', error);
}

export { };
