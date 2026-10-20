import { fileURLToPath } from 'node:url';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import {
  DEV_SERVER_HOST,
  DEV_SERVER_PORT,
  buildContentSecurityPolicy,
} from './src/shared/csp.ts';

/** 仓库根目录（构建工具使用；不进入运行时代码）。 */
const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));

function cspPlugin(): Plugin {
  return {
    name: 'bookkeep-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const policy = buildContentSecurityPolicy(ctx.server ? 'development' : 'production');
        const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
        return html.replace('<!--CSP-->', meta);
      },
    },
  };
}

export default defineConfig({
  root: path.resolve(REPO_ROOT, 'src/renderer'),
  base: './',
  plugins: [react(), cspPlugin()],
  server: {
    host: DEV_SERVER_HOST,
    port: DEV_SERVER_PORT,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(REPO_ROOT, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome152',
    sourcemap: false,
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1200,
  },
});
