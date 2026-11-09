import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: path.resolve(process.cwd(), 'web'),
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:4000' } },
  build: {
    outDir: path.resolve(process.cwd(), 'dist/web'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router', 'react-router-dom'],
        },
      },
    },
  },
});
