import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  base: '/v2/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
      '/img': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
      '/vendor': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
      '/css': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
      '/js': {
        target: 'http://localhost:3847',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: path.resolve(__dirname, '../public/v2'),
    emptyOutDir: true,
  },
});
