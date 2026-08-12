import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.PULSE_API_TARGET ?? 'https://pulse-production-7bcd.up.railway.app';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target, changeOrigin: true },
    },
  },
});
