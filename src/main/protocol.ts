/**
 * 生产环境本地资源协议：bookkeep://app/<path> 只映射打包后的渲染资源目录。
 * 拒绝目录穿越、非 app 主机与未知文件；不提供任意文件读取能力。
 */

import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_HOST, APP_SCHEME } from '../shared/constants';
import { isInsideDirectory } from './paths';

export interface AppSchemePrivilege {
  scheme: string;
  privileges: Record<string, boolean>;
}

/** 必须在 app ready 之前调用。 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ]);
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });
}

/** app ready 之后调用；rendererDir 必须是打包后的 dist/renderer 绝对路径。 */
export function serveRendererAssets(rendererDir: string, readImage?: (token:string)=>Promise<Buffer>): void {
  const rootDir = path.resolve(rendererDir);

  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return notFound();
    }
    if (url.host !== APP_HOST) return notFound();
    if (url.pathname.startsWith('/image/')) {
      if(request.method !== 'GET' || !readImage) return notFound();
      const token=url.pathname.slice('/image/'.length);
      if(!/^[a-f0-9-]{36}$/.test(token))return notFound();
      try { return new Response(new Uint8Array(await readImage(token)), {headers:{'content-type':'image/png','cache-control':'no-store','x-content-type-options':'nosniff'}}); }
      catch {return notFound();}
    }

    let decoded: string;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return notFound();
    }
    if (decoded.includes('\0')) return notFound();

    const relative = decoded === '/' || decoded === '' ? 'index.html' : decoded.replace(/^\/+/, '');
    const target = path.resolve(rootDir, relative);
    if (!isInsideDirectory(target, rootDir)) {
      return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    }

    try {
      return await net.fetch(pathToFileURL(target).toString());
    } catch {
      return notFound();
    }
  });
}
