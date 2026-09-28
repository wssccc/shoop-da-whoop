// main.js -- Shoop Da Whoop home page JS entry.
//
// The home page is a static meme collage, so there is no game logic here.
// It wires the shared PWA modules: service-worker registration + update
// banner (shared/pwa/pwa), and the "add to home screen" entry
// (shared/pwa/install). Future home features (search / filters / intro
// animations) belong in this file too.

import { initInstallEntry } from './shared/pwa/install';
import './shared/pwa/pwa';

initInstallEntry();

