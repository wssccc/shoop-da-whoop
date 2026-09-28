// "Add to home screen" entry for the home page.
//
// Deliberately NOT using @khmyznikov/pwa-install or similar components:
// they ship Lit 3 / ES2021 output that throws on iOS 13, and a static
// import would take the whole page down with it. This module is plain DOM:
//   * iOS Safari has no beforeinstallprompt, so tapping the entry shows a
//     step-by-step "Share -> Add to Home Screen" card;
//   * Chromium keeps the entry hidden until beforeinstallprompt fires,
//     then taps trigger the real native install dialog.
//
// The entry itself is <button id="pwa-install-btn" hidden> in index.html;
// this module only controls its visibility and click behaviour.

const INSTALL_FLAG_KEY = 'sdw.pwa-install';
const ENTRY_ID = 'pwa-install-btn';
const OVERLAY_ID = 'sdw-pwa-install-overlay';
const STYLE_ID = 'sdw-pwa-install-style';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let entryButton: HTMLButtonElement | null = null;

function readInstallFlag(): string | null {
  try {
    return window.localStorage.getItem(INSTALL_FLAG_KEY);
  } catch {
    return null; // private mode / storage disabled
  }
}

function writeInstallFlag(value: string): void {
  try {
    window.localStorage.setItem(INSTALL_FLAG_KEY, value);
  } catch {
    // Ignore: the button just stays visible next visit.
  }
}

function isStandalone(): boolean {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
  } catch {
    // fall through to the iOS-specific check
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ reports a desktop-class Macintosh UA; touch support gives it away.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

// NOTE: runtime-injected CSS — keep it iOS 13-safe (no `inset`, no flex `gap`).
const OVERLAY_CSS = `
.sdw-pwa-overlay {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  padding: 20px;
  background: rgba(0, 0, 0, 0.55);
}
.sdw-pwa-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  padding: 20px;
  border-radius: 12px;
  background: #1c1c22;
  color: #f5f5f5;
  font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.sdw-pwa-card h2 {
  margin: 0 0 10px;
  font-size: 16px;
}
.sdw-pwa-card p {
  margin: 0 0 8px;
}
.sdw-pwa-card ol {
  margin: 0 0 16px;
  padding-left: 20px;
}
.sdw-pwa-card li {
  margin-bottom: 6px;
}
.sdw-pwa-card .sdw-pwa-share {
  display: inline-block;
  vertical-align: -2px;
  margin: 0 2px;
}
.sdw-pwa-card-close {
  display: block;
  width: 100%;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: #39ff14;
  color: #0b0b0f;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
`;

const SHARE_GLYPH =
  '<svg class="sdw-pwa-share" width="13" height="17" viewBox="0 0 13 17" aria-hidden="true">' +
  '<path d="M6.5 1v9M6.5 1L3.2 4.3M6.5 1l3.3 3.3M2.5 6.5H1v9h11v-9h-1.5" ' +
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

function injectOverlayStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);
}

function showInstallCard(): void {
  if (document.getElementById(OVERLAY_ID)) return;
  injectOverlayStyle();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'sdw-pwa-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', '添加到主屏幕');
  overlay.innerHTML =
    '<div class="sdw-pwa-card">' +
    '<h2>安装到主屏幕</h2>' +
    '<p>用 Safari 添加后，从主屏图标启动即可全屏离线游玩：</p>' +
    '<ol>' +
    '<li>点按工具栏的 ' + SHARE_GLYPH + ' 「分享」按钮</li>' +
    '<li>向下滚动，选择「添加到主屏幕」</li>' +
    '<li>点按右上角「添加」</li>' +
    '</ol>' +
    '<button type="button" class="sdw-pwa-card-close">知道了</button>' +
    '</div>';
  document.body.appendChild(overlay);

  function closeCard(): void {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  }
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') closeCard();
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeCard();
  });
  const closeButton = overlay.querySelector('.sdw-pwa-card-close');
  if (closeButton) {
    closeButton.addEventListener('click', closeCard);
  }
  document.addEventListener('keydown', onKeyDown);
}

function updateEntryVisibility(): void {
  if (!entryButton) return;
  // Show when installation is possible and not done yet:
  //  * iOS Safari: no beforeinstallprompt, the card is the only hint;
  //  * Chromium: once the native prompt is actually available.
  const shouldShow =
    !isStandalone() &&
    readInstallFlag() !== 'installed' &&
    (isIos() || deferredPrompt !== null);
  entryButton.hidden = !shouldShow;
}

export function initInstallEntry(): void {
  try {
    entryButton = document.getElementById(ENTRY_ID) as HTMLButtonElement | null;
    if (!entryButton) return;

    entryButton.addEventListener('click', () => {
      if (deferredPrompt) {
        const promptEvent = deferredPrompt;
        deferredPrompt = null;
        void promptEvent
          .prompt()
          .then(() => promptEvent.userChoice)
          .then((choice) => {
            if (choice.outcome === 'accepted') {
              writeInstallFlag('installed');
            }
            updateEntryVisibility();
          })
          .catch(() => {
            updateEntryVisibility();
          });
      } else if (isIos()) {
        showInstallCard();
      }
    });

    updateEntryVisibility();

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      updateEntryVisibility();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      writeInstallFlag('installed');
      updateEntryVisibility();
    });
  } catch (error) {
    console.warn('[pwa] install entry setup failed:', error);
  }
}
