import { closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';

/** Reject junctions/symlinks in every existing component, including parent directories. */
export function regularPath(file: string, root: string, mustExist = true): string {
  const absolute = path.resolve(file), base = path.resolve(root);
  const relative=path.relative(base,absolute);
  if (relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)) throw new AppError('PERMISSION_DENIED');
  let walk = absolute;
  while (true) {
    if (existsSync(walk) && lstatSync(walk).isSymbolicLink()) throw new AppError('PERMISSION_DENIED');
    const parent = path.dirname(walk);
    if (parent === walk) break;
    walk = parent;
  }
  if (mustExist && (!existsSync(absolute) || !statSync(absolute).isFile())) throw new AppError('ARTIFACT_MISSING');
  if (existsSync(absolute) && existsSync(base)) {
    const canonical=path.relative(realpathSync(base),realpathSync(absolute));
    if(canonical==='..'||canonical.startsWith('..'+path.sep)||path.isAbsolute(canonical))throw new AppError('PERMISSION_DENIED');
  }
  return absolute;
}

/** Bound the read itself, including growth after stat, before allocating image/secret buffers. */
export function readBoundedFile(file:string,maxBytes:number):Buffer {
  const fd=openSync(file,'r');
  try{
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>maxBytes)throw new AppError('BACKUP_LIMIT');
    const bytes=Buffer.alloc(Math.min(stat.size+1,maxBytes+1));let size=0;
    while(size<bytes.length){const n=readSync(fd,bytes,size,bytes.length-size,null);if(!n)break;size+=n;}
    if(size>stat.size||size>maxBytes)throw new AppError('BACKUP_LIMIT');
    return bytes.subarray(0,size);
  }finally{closeSync(fd);}
}
