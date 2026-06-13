import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' so the built app works from any path (static hosting, CI artifact).
export default defineConfig({
  plugins: [react()],
  base: './',
});
