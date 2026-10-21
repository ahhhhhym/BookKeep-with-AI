/** 生成应用图标（原创图形：蓝色圆角方块 + 白色人民币符号），不依赖外部素材或字体。 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { ROOT, log } from './lib/paths.mjs';

const SIZE = 512;

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createCanvas(width, height) {
  return { width, height, pixels: Buffer.alloc(width * height * 4) };
}

function blendPixel(canvas, x, y, color, alpha) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height || alpha <= 0) return;
  const offset = (y * canvas.width + x) * 4;
  const current = canvas.pixels;
  const sourceAlpha = Math.min(1, alpha) * (color[3] / 255);
  const destinationAlpha = current[offset + 3] / 255;
  const outAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;
  for (let index = 0; index < 3; index += 1) {
    current[offset + index] = Math.round(
      (color[index] * sourceAlpha + current[offset + index] * destinationAlpha * (1 - sourceAlpha)) / outAlpha,
    );
  }
  current[offset + 3] = Math.round(outAlpha * 255);
}

function fillRoundedRect(canvas, x0, y0, x1, y1, radius, color) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(canvas.height, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(canvas.width, Math.ceil(x1)); x += 1) {
      const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
      const distance = Math.hypot(dx, dy);
      const alpha = distance <= radius ? 1 : 1 - Math.min(1, (distance - radius) / 1.5);
      blendPixel(canvas, x, y, color, alpha);
    }
  }
}

function strokeLine(canvas, x0, y0, x1, y1, thickness, color) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  const radius = thickness / 2;
  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
        const distance = Math.hypot(dx, dy);
        if (distance > radius + 1) continue;
        blendPixel(canvas, Math.round(cx + dx), Math.round(cy + dy), color, Math.min(1, radius + 1 - distance));
      }
    }
  }
}

export function renderIcon(size = SIZE) {
  const canvas = createCanvas(size, size);
  const scale = size / 512;
  const white = [255, 255, 255, 255];
  const blue = [37, 99, 235, 255];
  const deepBlue = [29, 78, 216, 255];

  fillRoundedRect(canvas, 16 * scale, 16 * scale, 496 * scale, 496 * scale, 112 * scale, deepBlue);
  fillRoundedRect(canvas, 32 * scale, 26 * scale, 480 * scale, 480 * scale, 104 * scale, blue);

  // 人民币符号：两条斜线 + 竖线 + 两条横线。
  strokeLine(canvas, 176 * scale, 150 * scale, 256 * scale, 262 * scale, 26 * scale, white);
  strokeLine(canvas, 336 * scale, 150 * scale, 256 * scale, 262 * scale, 26 * scale, white);
  strokeLine(canvas, 256 * scale, 250 * scale, 256 * scale, 382 * scale, 26 * scale, white);
  strokeLine(canvas, 186 * scale, 286 * scale, 326 * scale, 286 * scale, 22 * scale, white);
  strokeLine(canvas, 186 * scale, 336 * scale, 326 * scale, 336 * scale, 22 * scale, white);

  return encodePng(size, size, canvas.pixels);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const targetDir = path.join(ROOT, 'assets', 'app');
  mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, 'icon.png');
  writeFileSync(target, renderIcon());
  log(`icon generated: ${path.relative(ROOT, target)} (512x512 PNG)`);
}
