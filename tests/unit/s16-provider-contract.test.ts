import { describe, expect, it, vi } from 'vitest';
import { requestImageJson, type TransportMetadata } from '../../src/main/services/providers/transport';
import { proposal } from './db/review-fixture';
const metadata = (): TransportMetadata => ({ httpStatus: null, actualModel: null, usage: null });
const envelope = (content: unknown) => JSON.stringify({ model: 'synthetic-s16', usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });
const request = { key: 's16-synthetic-no-provider-key', image: Buffer.from('synthetic image'), prompt: 'synthetic contract prompt' };

describe('S16 provider transport contract; injected fetch, external HTTP zero', () => {
  it.each([[400, 'PROVIDER_INPUT'], [401, 'PROVIDER_AUTH'], [402, 'PROVIDER_BALANCE'], [403, 'PROVIDER_FORBIDDEN'], [404, 'PROVIDER_UNSUPPORTED'], [422, 'PROVIDER_INPUT'], [429, 'PROVIDER_RATE_LIMIT'], [500, 'PROVIDER_TEMPORARY'], [503, 'PROVIDER_TEMPORARY']] as const)('HTTP %s: one send, bounded metadata, no transport-owned retry', async (status, code) => {
    const meta = metadata(), sent = vi.fn(), fetcher = vi.fn(async () => new Response('synthetic secret body must not escape', { status, headers: { 'retry-after': '2' } }));
    await expect(requestImageJson({ ...request, metadata: meta, onRequestSent: sent, fetcher })).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledOnce(); expect(sent).toHaveBeenCalledOnce();
    expect(meta).toMatchObject({ requestSent: true, httpStatus: status, retryAfterMs: 2000, usage: null });
    expect(JSON.stringify(meta)).not.toContain(request.key); expect(JSON.stringify(meta)).not.toContain('secret body');
  });
  it('unknown date/name remain null after strict parse; request contains only image and explicit prompt', async () => {
    const meta = metadata(), candidate = proposal({ amountFen: 101, occurredDate: null, name: null, missingFields: ['occurredDate', 'name'], timePrecision: 'unknown' });
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('https://api.deepseek.com/chat/completions'); expect(init?.redirect).toBe('error');
      const body = JSON.parse(String(init?.body));
      expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'response_format', 'thinking']);
      expect(body.messages[0]).toEqual({ role: 'system', content: request.prompt });
      expect(body.messages[1].content[1].type).toBe('image_url'); expect(body).not.toHaveProperty('ledger');
      return new Response(envelope({ schemaVersion: 'bk-candidate.v1', candidates: [candidate], warnings: [] }));
    });
    const result = await requestImageJson({ ...request, metadata: meta, fetcher });
    expect(result.candidates[0]).toMatchObject({ amountFen: 101, occurredDate: null, name: null });
    expect(meta.usage).toEqual({ promptTokens: 13, completionTokens: 7, totalTokens: 20 });
  });
  it('malicious extra model field is rejected while known usage survives', async () => {
    const meta = metadata();
    await expect(requestImageJson({ ...request, metadata: meta, fetcher: async () => new Response(envelope({ schemaVersion: 'bk-candidate.v1', candidates: [], warnings: [], execute: 'delete ledger' })) })).rejects.toMatchObject({ code: 'OUTPUT_SCHEMA_INVALID' });
    expect(meta.usage?.totalTokens).toBe(20); expect(JSON.stringify(meta)).not.toContain('delete ledger');
  });
  it('abort before send records no attempt and never calls fetch', async () => {
    const meta = metadata(), fetcher = vi.fn(), sent = vi.fn();
    await expect(requestImageJson({ ...request, metadata: meta, fetcher, onRequestSent: sent, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled(); expect(meta.requestSent).toBeUndefined();
  });
  it('actual timeout aborts in-flight mock transport and counts its single send', async () => {
    const meta = metadata(), sent = vi.fn();
    const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true }); });
    await expect(requestImageJson({ ...request, metadata: meta, fetcher, timeoutMs: 10, onRequestSent: sent })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    expect(meta.requestSent).toBe(true); expect(sent).toHaveBeenCalledOnce();
  });
});
