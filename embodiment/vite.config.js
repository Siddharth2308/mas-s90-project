import { defineConfig } from 'vite';
import { brain } from './server/brain.js';
import { remote } from './server/remote.js';

export default defineConfig({
  plugins: [brain(), remote()],
  server: {
    watch: { ignored: ['**/tts/**', '**/quarantine/**', '**/server/**', '**/.cert/**'] },
  },
});
