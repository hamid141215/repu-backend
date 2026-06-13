import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.join(__dirname, 'src') }
  },
  build: {
    // Build straight into ../public-app/ so Express can serve it without extra steps.
    outDir: path.join(__dirname, '..', 'public-app'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  server: {
    port: 5173,
    // During dev, proxy backend calls so the SPA hits same-origin /api/* like in prod.
    proxy: {
      '/api':     { target: 'https://repu.mawjatalsamt.com', changeOrigin: true, secure: true },
      '/r':       { target: 'https://repu.mawjatalsamt.com', changeOrigin: true, secure: true },
      '/webhook': { target: 'https://repu.mawjatalsamt.com', changeOrigin: true, secure: true }
    }
  }
});
