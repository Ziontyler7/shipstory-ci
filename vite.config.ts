import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5182,
    strictPort: true,
    cors: false,
    fs: {
      strict: true,
      allow: [path.resolve(import.meta.dirname)],
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**'],
    },
    proxy: {
      '/api/nvidia/v1': {
        target: 'https://integrate.api.nvidia.com/v1',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api\/nvidia\/v1/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5182,
    strictPort: true,
    cors: false,
  },
});
