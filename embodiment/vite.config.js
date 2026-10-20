import { defineConfig } from 'vite';
import { brain } from './server/brain.js';

export default defineConfig({
  plugins: [brain()],
  server: {
    watch: { ignored: ['**/tts/**', '**/quarantine/**', '**/server/**'] },
  },
});
