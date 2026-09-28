import '98.css';
import { createApp } from 'vue';
import '../../../shared/styles/reset.css';
import '../../../shared/styles/game-home-link.css';
import App from './App.vue';
import './index.css';
// PWA: register the service worker + update banner (shared by every entry).
import '../../../shared/pwa/pwa';

createApp(App).mount('#root');
