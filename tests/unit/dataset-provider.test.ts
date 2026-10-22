import { afterEach, expect, it, vi } from 'vitest';
import { deepseekEvaluationProvider, attemptsOnError, metadataOnError } from '../../src/main/services/dataset/provider';
import { proposal } from '../fixtures/s13';
const input = { sampleId: 'synthetic', image: Buffer.from('synthetic image bytes'), prompt: 'versioned synthetic prompt; no ground truth', signal: new AbortController().signal, categories: [] };
afterEach(() => vi.unstubAllGlobals());
it('real adapter uses image transport, versioned prompt and actual returned model/usage; mock transport only', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => { const payload = JSON.parse(String(options.body)); expect(payload.messages[0].content).toBe(input.prompt); expect(payload.messages[1].content[1].type).toBe('image_url'); expect(payload).not.toHaveProperty('labels'); return new Response(JSON.stringify({ model: 'synthetic-returned-model', usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ schemaVersion: 'bk-candidate.v1', candidates: [proposal()], warnings: [] }) } }] }), { status: 200 }); });
    vi.stubGlobal('fetch', fetcher);
    const provider = deepseekEvaluationProvider(() => 'synthetic-test-secret');
    const response = await provider.recognize(input);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(response.metadata).toMatchObject({ requestSent: true, actualModel: 'synthetic-returned-model', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } });
});
it('failed schema keeps real returned attempt usage but never partial correct candidate fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ model: 'synthetic-returned-model', usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 }, choices: [{ finish_reason: 'stop', message: { content: '{"schemaVersion":"wrong"}' } }] }), { status: 200 })));
    try {
        await deepseekEvaluationProvider(() => 'synthetic-test-secret').recognize(input);
        throw Error('should fail');
    }
    catch (e) {
        expect(e).toMatchObject({ code: 'OUTPUT_SCHEMA_INVALID' });
        expect(attemptsOnError(e)).toBe(1);
        expect(metadataOnError(e)).toEqual({ promptTokens: 7, completionTokens: 4, totalTokens: 11 });
    }
});
it('absent key / aborted before send creates zero HTTP attempts', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    for (const request of [input, { ...input, signal: AbortSignal.abort() }]) {
        try {
            await deepseekEvaluationProvider(() => '').recognize(request);
            throw Error('should fail');
        }
        catch (e) {
            expect(attemptsOnError(e)).toBe(0);
        }
    }
    expect(fetcher).not.toHaveBeenCalled();
});
