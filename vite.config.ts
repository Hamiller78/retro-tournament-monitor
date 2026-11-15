import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: { port: Number(process.env.VITE_PORT ?? 5173), strictPort: true, proxy: {
    '/api': `http://127.0.0.1:${process.env.PORT ?? 3000}`,
    '/ws': { target: `ws://127.0.0.1:${process.env.PORT ?? 3000}`, ws: true },
  } },
});
