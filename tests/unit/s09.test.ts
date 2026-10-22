import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { SecretStore, type SecretEncryption } from '../../src/main/services/settings/ai-settings';
import { requestImageJson, type TransportMetadata } from '../../src/main/services/providers/transport';
import { PROBE_PROMPT, FIXTURE_SHA256, ProbeService } from '../../src/main/services/providers/probe';
import { createHash } from 'node:crypto';
import { parseCandidateOutput } from '../../src/shared/candidate';
import { validateIpcRequest } from '../../src/main/ipc/validate-request';
import { CHANNEL_SPECS } from '../../src/shared/ipc';
import { CONTRACT_VERSION } from '../../src/shared/constants';

const syntheticSecret = 'unit-test-only-not-a-provider-key';
function setup(available = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bookkeep-s09-unit-'));
  const key = randomBytes(32);
  const encryption: SecretEncryption = {
    isEncryptionAvailable: () => available,
    encryptString: (text) => { const iv = randomBytes(16); const cipher = createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final()]); },
    decryptString: (data) => { const decipher = createDecipheriv('aes-256-cbc', key, data.subarray(0, 16)); return Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString('utf8'); },
  };
  return { dir, encryption, store: new SecretStore(dir, encryption), file: path.join(dir, 'deepseek.secret.json') };
}
const save = (expectedVersion = 0, persistence: 'encrypted' | 'session' = 'encrypted') => ({ expectedVersion, action: 'save' as const, secret: syntheticSecret, persistence });
const image = readFileSync(path.resolve('assets/probe/s09-receipt-v1.png'));
function metadata(): TransportMetadata { return { httpStatus: null, actualModel: null, usage: null }; }
const output = { schemaVersion: 'bk-candidate.v1', candidates: [{ amountFen: 3742, occurredDate: '2026-08-19', occurredTime: null, timePrecision: 'date', name: '燕麦饼干', merchant: '示例食品店', categoryId: 'cat_food', transactionKind: 'expense', amountBasis: 'paid_total', groupKey: null, lineItems: [], evidence: ['amountFen', 'occurredDate', 'name', 'categoryId'].map((field) => ({ field, text: '合成可见证据', region: null, source: 'image' })), missingFields: [], warnings: [], confidence: null }], warnings: [] };
const success = (content = JSON.stringify(output), finish = 'stop', model = 'deepseek-flash') => new Response(JSON.stringify({ model, choices: [{ finish_reason: finish, message: { content } }], usage: { prompt_tokens: 321, completion_tokens: 123, total_tokens: 444 } }));
describe('S09 secret store (mock encryption, no real provider key)', () => {
  it('encrypts, reloads, CAS rejects stale save; status never exposes key', () => {
    const { store, file, dir, encryption } = setup();
    expect(store.status().configured).toBe(false);
    expect(store.save(save(), 'a')).toMatchObject({ mode: 'encrypted', version: 1 });
    expect(readFileSync(file, 'utf8')).not.toContain(syntheticSecret);
    expect(JSON.stringify(store.status())).not.toContain(syntheticSecret);
    expect(new SecretStore(dir, encryption).readForProvider()).toBe(syntheticSecret);
    expect(() => store.save(save(), 'b')).toThrow('VERSION_CONFLICT');
  });
  it('replay only safe result, never reapplies new secret on same mutation id', () => {
    const { store } = setup(); const first = store.save(save(), 'a');
    expect(store.save({ ...save(), secret: 'different' }, 'a')).toEqual(first);
    expect(store.readForProvider()).toBe(syntheticSecret);
  });
  it('unavailable encryption falls back to session with no plaintext disk copy', () => {
    const { store, file, dir, encryption } = setup(false);
    expect(store.save(save(), 'a').mode).toBe('session');
    expect(store.readForProvider()).toBe(syntheticSecret);
    expect(readFileSync(file, 'utf8')).not.toContain(syntheticSecret);
    expect(new SecretStore(dir, encryption).status()).toMatchObject({ configured: false, version: 1 });
  });
  it('switch session or remove does not resurrect encrypted key on restart', () => {
    const { store, dir, encryption } = setup(); store.save(save(), 'a'); store.save(save(1, 'session'), 'b');
    expect(new SecretStore(dir, encryption).status().configured).toBe(false);
    store.save({ expectedVersion: 2, action: 'remove' }, 'c');
    expect(() => new SecretStore(dir, encryption).readForProvider()).toThrow('SECRET_REQUIRED');
  });
  it.each([' abc', 'abc ', 'a\nb', 'a\tb', 'a b', ''])('rejects invalid opaque input without writing (%j)', (value) => {
    const { store } = setup(); expect(() => store.save({ ...save(), secret: value }, 'a')).toThrow('SECRET_INVALID');
    expect(store.status().version).toBe(0);
  });
  it('S15 actual encryption failure revokes prior persistent blob and keeps only this session', () => {
    const { store, file, dir, encryption } = setup(); store.save(save(), 'a');
    encryption.encryptString = () => { throw new Error('untrusted message'); };
    expect(store.save(save(1), 'b')).toMatchObject({mode:'session',version:2});
    expect(JSON.parse(readFileSync(file,'utf8'))).toMatchObject({mode:'absent',blob:null});
    expect(store.readForProvider()).toBe(syntheticSecret);
    expect(new SecretStore(dir,encryption).status()).toMatchObject({configured:false,version:2});
  });
  it('corrupt encrypted store is reported unreadable, explicit removal permits recovery', () => {
    const { dir, file, encryption } = setup(); writeFileSync(file, '{broken'); const store = new SecretStore(dir, encryption);
    expect(store.status().lastErrorCode).toBe('SECRET_UNREADABLE');
    expect(() => store.save(save(), 'a')).toThrow('SECRET_UNREADABLE');
    store.save({ expectedVersion: 0, action: 'remove' }, 'b'); expect(store.status().configured).toBe(false);
  });
  it('rename failure preserves old ciphertext and in-memory state', () => {
    const { dir, encryption, store } = setup(); mkdirSync(path.join(dir, 'deepseek.secret.json'));
    expect(() => store.save(save(), 'a')).toThrow('STORAGE_UNAVAILABLE');
    expect(store.status()).toMatchObject({ configured: false, version: 0 });
    expect(new SecretStore(dir, encryption).status().lastErrorCode).toBe('SECRET_UNREADABLE');
  });
});
describe('S09 HTTP mocks (not real API evidence)', () => {
  it('sends exact PNG bytes, model, JSON, disabled thinking once; prompt has no truth', async () => {
    let calls = 0; const meta = metadata();
    const fetcher = (async (url, init) => {
      calls++; expect(url).toBe('https://api.deepseek.com/chat/completions'); expect(init?.redirect).toBe('error');
      const body = JSON.parse(String(init?.body)); expect(body.model).toBe('deepseek-flash'); expect(body.response_format.type).toBe('json_object');
      expect(body.thinking.type).toBe('disabled'); const encoded = body.messages[1].content[1].image_url.url.split(',')[1];
      expect(Buffer.from(encoded, 'base64')).toEqual(image); return success();
    }) as typeof fetch;
    const result = await requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: meta, fetcher });
    expect(parseCandidateOutput(result)).toEqual(output); expect(calls).toBe(1); expect(meta.usage?.totalTokens).toBe(444);
    for (const truth of ['37.42', '3742', '2026-08-19', '燕麦饼干']) expect(PROBE_PROMPT).not.toContain(truth);
    expect(createHash('sha256').update(image).digest('hex')).toBe(FIXTURE_SHA256);
  });
  it.each([[401,'PROVIDER_AUTH'],[403,'PROVIDER_FORBIDDEN'],[402,'PROVIDER_BALANCE'],[400,'PROVIDER_INPUT'],[404,'PROVIDER_UNSUPPORTED'],[422,'PROVIDER_INPUT'],[429,'PROVIDER_RATE_LIMIT'],[503,'PROVIDER_TEMPORARY']] as const)('HTTP %i maps safely with one attempt', async (status, code) => {
    let calls = 0;
    const run = requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: metadata(), fetcher: (async () => { calls++; return new Response('private body must not escape', { status }); }) as typeof fetch });
    await expect(run).rejects.toMatchObject({ code, message: code }); expect(calls).toBe(1);
  });
  it('timeout aborts actual pending fetch and returns safe code', async () => {
    const fetcher = ((_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('secret-like raw error'))); })) as typeof fetch;
    await expect(requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: metadata(), fetcher, timeoutMs: 5 })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
  });
  it('network exception text cannot escape', async () => {
    await expect(requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: metadata(), fetcher: (async () => { throw new Error(syntheticSecret); }) as typeof fetch })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'NETWORK_ERROR' });
  });
  it.each(['', '{bad', '{}', JSON.stringify({ ...output, candidates: [{ ...output.candidates[0], amountFen: 0.5 }] })])('rejects empty/bad/contract-invalid output', async (content) => {
    await expect(requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: metadata(), fetcher: (async () => success(content)) as typeof fetch })).rejects.toMatchObject({ code: 'OUTPUT_SCHEMA_INVALID' });
  });
  it('rejects truncated and oversized output', async () => {
    await expect(requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: metadata(), fetcher: (async () => success(JSON.stringify(output), 'length')) as typeof fetch })).rejects.toMatchObject({ code: 'OUTPUT_SCHEMA_INVALID' });
    await expect(requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: metadata(), fetcher: (async () => new Response('x'.repeat(1024 * 1024 + 1))) as typeof fetch })).rejects.toMatchObject({ code: 'OUTPUT_TOO_LARGE' });
  });
  it('missing secret probe is cached, no HTTP and no readiness upgrade', async () => {
    const { store, dir } = setup(); const probe = new ProbeService(store, path.resolve('assets/probe/s09-receipt-v1.png'), path.join(dir, 'logs'));
    const report = await probe.run('same'); expect(report).toMatchObject({ kind: 'real-api', passed: false, requestCount: 0, errorCode: 'SECRET_REQUIRED' });
    store.save(save(), 'key'); expect(await probe.run('same')).toBe(report); expect(probe.verified).toBe(false);
  });
  it('only matching schema-valid HTTP output upgrades readiness; replay avoids second fetch', async () => {
    const { store, dir } = setup(); store.save(save(), 'key');
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => success());
    try {
      const probe = new ProbeService(store, path.resolve('assets/probe/s09-receipt-v1.png'), path.join(dir, 'logs'));
      const first = await probe.run('a'); expect(first.passed).toBe(true); expect(probe.verified).toBe(true);
      expect(await probe.run('a')).toBe(first); expect(spy).toHaveBeenCalledTimes(1);
      store.save(save(1), 'new-key'); expect(probe.verified).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it('schema diagnostics only expose controlled paths/codes, not unknown key or raw response', async () => {
    const meta = metadata();
    const bad = { ...output, [syntheticSecret]: 'secret-like-text' };
    await expect(requestImageJson({ key: syntheticSecret, image, prompt: PROBE_PROMPT, metadata: meta, fetcher: (async () => success(JSON.stringify(bad))) as typeof fetch })).rejects.toMatchObject({ code: 'OUTPUT_SCHEMA_INVALID' });
    expect(JSON.stringify(meta)).not.toContain(syntheticSecret); expect(meta.diagnostics?.issues).toEqual([{ path: 'root', code: 'UNKNOWN_KEY' }]);
  });
  it('probe IPC rejects unconsented or arbitrary URL/key payload', () => {
    const base = { contractVersion: CONTRACT_VERSION, requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', mutationId: '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f', dataEpoch: '9b2f8f6a-1c2d-4e3f-8a9b-0c1d2e3f4a5b' };
    for (const payload of [{ fixtureId: 's09-receipt-v1', uploadConsent: false, possibleChargeAccepted: true }, { fixtureId: 's09-receipt-v1', uploadConsent: true, possibleChargeAccepted: true, url: 'https://example.com', key: syntheticSecret }]) expect(() => validateIpcRequest(CHANNEL_SPECS.providerProbe, { ...base, payload }, { expectedEpoch: base.dataEpoch })).toThrow();
  });
});
