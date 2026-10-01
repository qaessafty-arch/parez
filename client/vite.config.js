import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  root: path.join(ROOT, 'client'),
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4177', changeOrigin: true },
    },
  },
  build: {
    outDir: path.join(ROOT, 'client', 'dist'),
    emptyOutDir: true,
  },
});
