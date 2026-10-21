/** UUID v4 生成：优先 WebCrypto，其次 getRandomValues，最后仅退化为满足格式的伪随机值。 */

interface WebCryptoLike {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function formatV4(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (const byte of bytes) parts.push(byte.toString(16).padStart(2, '0'));
  // 版本位固定为 4，变体位固定为 10xx（RFC 4122）。
  const versionByte = `4${(parts[6] ?? '00').slice(1)}`;
  const variantHigh = (Number.parseInt((parts[8] ?? '00').slice(0, 1), 16) & 0x3) | 0x8;
  const variantByte = `${variantHigh.toString(16)}${(parts[8] ?? '00').slice(1)}`;
  parts[6] = versionByte;
  parts[8] = variantByte;
  const joined = parts.join('');
  return [
    joined.slice(0, 8),
    joined.slice(8, 12),
    joined.slice(12, 16),
    joined.slice(16, 20),
    joined.slice(20, 32),
  ].join('-');
}

export function newUuidV4(): string {
  const cryptoApi = (globalThis as { crypto?: WebCryptoLike }).crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return formatV4(bytes);
}
