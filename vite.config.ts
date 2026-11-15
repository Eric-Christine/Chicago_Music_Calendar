import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the build works at a domain root or under /Chicago_Music_Calendar/ on GitHub Pages
  base: './',
  plugins: [react()],
  server: {
    port: 5188,
    proxy: {
      '/api': {
        target: 'http://localhost:3088',
        changeOrigin: true,
      },
    },
  },
});
