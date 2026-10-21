/** 最小 ZIP 读取/解压（仅支持 stored/deflate，用于核验本项目生成的 Windows ZIP）。 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function readZip(buffer) {
  let eocd = -1;
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let index = buffer.length - 22; index >= minimum; index -= 1) {
    if (buffer.readUInt32LE(index) === EOCD_SIGNATURE) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件（未找到 EOCD）');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error('ZIP 中央目录损坏');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    entries.push({ name, flags, method, crc, compressedSize, size, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(buffer, entry) {
  if ((entry.flags & 0x1) !== 0) throw new Error(`不支持加密条目：${entry.name}`);
  const local = entry.localOffset;
  if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error(`本地文件头损坏：${entry.name}`);
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const raw = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  throw new Error(`不支持的压缩算法 ${entry.method}：${entry.name}`);
}

function assertSafeEntryName(name, destination) {
  const normalized = name.replace(/\\/g, '/');
  if (normalized.includes('\0')) throw new Error('ZIP 条目包含 NUL');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`ZIP 条目为绝对路径：${name}`);
  }
  const segments = normalized.split('/');
  if (segments.includes('..')) throw new Error(`ZIP 条目包含上级目录：${name}`);
  const target = path.resolve(destination, normalized);
  const root = path.resolve(destination);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`ZIP 条目越界：${name}`);
  }
  return { normalized, target };
}

/** 解压到目标目录，返回实际写入的相对路径列表。 */
export function extractZip(buffer, destination) {
  const entries = readZip(buffer);
  const written = [];
  for (const entry of entries) {
    if (entry.name.endsWith('/') || entry.name.endsWith('\\')) continue;
    const { normalized, target } = assertSafeEntryName(entry.name, destination);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readEntryData(buffer, entry));
    written.push(normalized);
  }
  return written;
}

export function readZipFile(filePath) {
  return readZip(readFileSync(filePath));
}

export function zipEntryData(buffer, entry) {
  return readEntryData(buffer, entry);
}
