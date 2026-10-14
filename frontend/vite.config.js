import fs from 'fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const CANVAS_LAYOUTS = path.resolve(__dirname, '../server/pdf/canvas-layouts.js');
const VIRTUAL_LAYOUTS = '\0virtual:canvas-layouts';

function canvasLayoutsFromServer() {
  return {
    name: 'canvas-layouts-from-server',
    resolveId(source) {
      if (source === 'virtual:canvas-layouts') return VIRTUAL_LAYOUTS;
    },
    load(id) {
      if (id !== VIRTUAL_LAYOUTS) return null;
      const src = fs.readFileSync(CANVAS_LAYOUTS, 'utf8');
      const start = src.indexOf('function () {');
      if (start < 0) throw new Error('canvas-layouts.js 找不到 factory');
      let body = src.slice(start).trim();
      if (!body.endsWith(');')) throw new Error('canvas-layouts.js 結尾不是 UMD');
      body = body.slice(0, -2);
      return `export default (${body})();\n`;
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [vue(), canvasLayoutsFromServer()],
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
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: false,
  },
});
