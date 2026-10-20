/**
 * 开发模式：Vite dev server（渲染层 HMR）+ esbuild watch（主进程/preload）。
 * 主进程或 preload 变化时重启 Electron；不接受外部参数。
 *
 * 注意：DSH 运行时会注入 ELECTRON_RUN_AS_NODE=1，本脚本在启动前移除它，
 * 否则 electron.exe 会按纯 Node 运行、不会打开窗口。
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { electronExecutable, electronSafeEnv, log, ROOT } from './lib/paths.mjs';
import { mainBuildOptions, preloadBuildOptions } from './build.mjs';

const server = await createServer({
  configFile: path.join(ROOT, 'vite.config.ts'),
  mode: 'development',
});
await server.listen();

const devUrl = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5273/';
log(`renderer dev server: ${devUrl}`);

let child = null;
let restartTimer = null;
let readyToRestart = false;
let shuttingDown = false;

function startElectron() {
  if (shuttingDown) return;
  const executable = electronExecutable();
  child = spawn(executable, [ROOT], {
    cwd: ROOT,
    env: electronSafeEnv({ BOOKKEEP_DEV_SERVER_URL: devUrl }),
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (shuttingDown) return;
    log(`electron 退出（code=${code}）；修改主进程代码会自动重启，Ctrl+C 结束开发服务。`);
    child = null;
  });
}

function scheduleRestart(kind) {
  if (!readyToRestart || shuttingDown) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    log(`${kind} 已重新构建，重启 Electron…`);
    if (child) {
      child.kill();
      child = null;
    }
    startElectron();
  }, 200);
}

function restartPlugin(kind) {
  let buildEvents = 0;
  return {
    name: `restart-${kind}`,
    setup(build) {
      build.onEnd((result) => {
        buildEvents += 1;
        // 前两次 onEnd 来自显式 rebuild() 与 watch() 的初始构建；Electron 由本脚本启动一次即可。
        if (buildEvents <= 2) return;
        if (result.errors.length > 0) {
          console.error(`[bookkeep] ${kind} 构建失败，保持当前窗口`);
          return;
        }
        scheduleRestart(kind);
      });
    },
  };
}

const mainContext = await context({ ...mainBuildOptions(), plugins: [restartPlugin('主进程')] });
const preloadContext = await context({ ...preloadBuildOptions(), plugins: [restartPlugin('preload')] });

await mainContext.rebuild();
await preloadContext.rebuild();
await mainContext.watch();
await preloadContext.watch();

readyToRestart = true;
startElectron();

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`收到 ${signal}，关闭开发服务…`);
  clearTimeout(restartTimer);
  if (child) child.kill();
  await Promise.allSettled([mainContext.dispose(), preloadContext.dispose(), server.close()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
