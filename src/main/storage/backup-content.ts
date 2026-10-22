/** Bounded embedded attachments: no archive-controlled path is ever resolved for extraction. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppError } from '../../shared/errors';
import type { SqliteDb } from '../db/sqlite';
import { readBoundedFile, regularPath } from './safe-file';

export const CONTENT_VERSION = 'bk-content.v2';
export const CONTENT_LIMIT = 512 * 1024 * 1024;
export const CONTENT_COUNT_LIMIT = 10000;
export const ATTACHMENT_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}-(original\.bin|prepared\.png)$/;
export const digest = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
type Ref = { ref: string; hash: string; size: number | null };
export function attachmentRefs(db: SqliteDb): Ref[] {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='image_asset'").get()) return [];
  const refs = new Map<string, Ref>();
  const rows = db.prepare<{ original_ref:string|null; original_hash:string; byte_size:number; source:string; prepared_ref:string|null; prepared_hash:string|null }>('SELECT * FROM image_asset WHERE deleted_at IS NULL').all();
  for (const row of rows) for (const item of [
    { ref: row.original_ref, hash: row.original_hash, size: row.source==='prepared'?null:row.byte_size },
    { ref: row.prepared_ref, hash: row.prepared_hash, size: row.source==='prepared'?row.byte_size:null },
  ]) {
    if (!item.ref) continue;
    if (!ATTACHMENT_NAME.test(item.ref) || !item.hash || !/^[a-f0-9]{64}$/.test(item.hash)) throw new AppError('BACKUP_INVALID');
    const old = refs.get(item.ref);
    if (old && old.hash !== item.hash) throw new AppError('BACKUP_INVALID');
    refs.set(item.ref, item as Ref);
  }
  return [...refs.values()].sort((a,b)=>a.ref.localeCompare(b.ref));
}

/** Stable logical DB digest; container tables excluded, all business/schema rows included. */
export function databaseDigest(db: SqliteDb): string {
  const hash = createHash('sha256');
  const schema=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('backup_manifest','backup_content') AND tbl_name NOT IN ('backup_manifest','backup_content') ORDER BY type,name").all();
  hash.update(JSON.stringify(schema));
  const tables = db.prepare<{name:string;sql:string}>("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('backup_manifest','backup_content') ORDER BY name").all();
  for (const table of tables) {
    hash.update(JSON.stringify([table.name,table.sql]));
    const name = '"' + table.name.replaceAll('"','""') + '"';
    const rows = db.prepare(`SELECT * FROM ${name}`).all().map(r=>JSON.stringify(r)).sort();
    for (const row of rows) hash.update(row+'\n');
  }
  return hash.digest('hex');
}
export function embedAttachments(db: SqliteDb, directory: string, root: string) {
  db.exec('CREATE TABLE IF NOT EXISTS backup_content (ref TEXT PRIMARY KEY, bytes BLOB NOT NULL) STRICT; DELETE FROM backup_content');
  const files: {path:string;role:'attachment';size:number;sha256:string}[]=[];
  let total=0;
  for (const item of attachmentRefs(db)) {
    const file=regularPath(path.join(directory,item.ref),root);
    const bytes=readBoundedFile(file,10*1024*1024); total+=bytes.length;
    if (bytes.length===0 || bytes.length>10*1024*1024 || total>CONTENT_LIMIT || files.length>=CONTENT_COUNT_LIMIT || digest(bytes)!==item.hash || (item.size!==null && bytes.length!==item.size)) throw new AppError('BACKUP_INVALID');
    db.prepare('INSERT INTO backup_content VALUES (?,?)').run(item.ref,bytes);
    files.push({path:'attachments/'+item.ref,role:'attachment',size:bytes.length,sha256:item.hash});
  }
  return files;
}
export function verifyAttachments(db: SqliteDb, files: readonly {path:string;role:string;size:number;sha256:string}[]): void {
  const refs=attachmentRefs(db), expected=files.filter(f=>f.role==='attachment');
  const table=db.prepare("SELECT name FROM sqlite_master WHERE name='backup_content' AND type='table'").get();
  if (!table || refs.length!==expected.length || refs.length>CONTENT_COUNT_LIMIT) throw new AppError('BACKUP_INVALID');
  const count=db.prepare<{n:number}>('SELECT count(*) n FROM backup_content').get()!.n;
  if (count!==refs.length || new Set(expected.map(f=>f.path)).size!==expected.length) throw new AppError('BACKUP_INVALID');
  let total=0;
  for (const ref of refs) {
    const f=expected.find(f=>f.path==='attachments/'+ref.ref);
    const row=db.prepare<{bytes:Buffer}>('SELECT bytes FROM backup_content WHERE ref=?').get(ref.ref);
    if(!row || !f || !Number.isSafeInteger(f.size) || f.size<1 || f.size>10*1024*1024 || f.sha256!==ref.hash || row.bytes.length!==f.size || digest(row.bytes)!==f.sha256 || (ref.size!==null && ref.size!==f.size)) throw new AppError('BACKUP_INVALID');
    total+=f.size;
    if(total>CONTENT_LIMIT)throw new AppError('BACKUP_LIMIT');
  }
}
export function extractAttachments(db: SqliteDb, destination: string): void {
  // Destination is a newly generated UUID generation, never a caller-supplied archive path.
  const directory=path.join(path.dirname(destination),'attachments');
  regularPath(directory,path.dirname(destination),false);
  mkdirSync(directory,{recursive:true});
  for(const ref of attachmentRefs(db)) {
    const bytes=db.prepare<{bytes:Buffer}>('SELECT bytes FROM backup_content WHERE ref=?').get(ref.ref)?.bytes;
    if(!bytes)throw new AppError('BACKUP_INVALID');
    const file=regularPath(path.join(directory,ref.ref),directory,false);
    if(existsSync(file))throw new AppError('BACKUP_INVALID');
    writeFileSync(file,bytes,{flag:'wx'});
  }
  db.exec('DROP TABLE IF EXISTS backup_content; DROP TABLE IF EXISTS backup_manifest');
}
