/** Fixed official endpoint; one request, bounded body, no raw error/body logging. */
import { AppError, type ErrorCode } from '../../../shared/errors';
import { CandidateSchemaError, parseCandidateOutput, type CandidateOutput } from '../../../shared/candidate';
import { DEEPSEEK_MODEL } from '../../../shared/constants';
export const ENDPOINT = 'https://api.deepseek.com/chat/completions';
export interface TransportMetadata {
  diagnostics?: { stage: string; finishReason: string | null; issues: { path: string; code: string }[] };
  httpStatus: number | null;
  actualModel: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
}
export function httpError(status: number): ErrorCode {
  if (status === 401) return 'PROVIDER_AUTH';
  if (status === 403) return 'PROVIDER_FORBIDDEN';
  if (status === 402) return 'PROVIDER_BALANCE';
  if (status === 429) return 'PROVIDER_RATE_LIMIT';
  if (status >= 500) return 'PROVIDER_TEMPORARY';
  if (status === 404) return 'PROVIDER_UNSUPPORTED';
  if (status === 400 || status === 422) return 'PROVIDER_INPUT';
  return 'PROVIDER_ERROR';
}
export async function requestImageJson(options: {
  key: string; image: Buffer; prompt: string; metadata: TransportMetadata;
  fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<CandidateOutput> {
  if (options.image.length === 0 || options.image.length > 10 * 1024 * 1024) throw new AppError('IMAGE_TOO_LARGE');
  const abort = new AbortController();
  const diagnostics = { stage: 'request', finishReason: null as string | null, issues: [] as { path: string; code: string }[] };
  options.metadata.diagnostics = diagnostics;
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 90000);
  try {
    const response = await (options.fetcher ?? fetch)(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: abort.signal,
      headers: { Authorization: `Bearer ${options.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, thinking: { type: 'disabled' }, max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: options.prompt }, { role: 'user', content: [
          { type: 'text', text: '读取这张无隐私合成消费图中的可见字段，按指定json格式输出。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${options.image.toString('base64')}`, detail: 'high' } },
        ] }] }),
    });
    options.metadata.httpStatus = response.status;
    if (!response.ok) { await response.body?.cancel(); throw new AppError(httpError(response.status), { details: { providerStatus: response.status } }); }
    const reader = response.body?.getReader();
    if (!reader) throw new AppError('OUTPUT_SCHEMA_INVALID');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); throw new AppError('OUTPUT_TOO_LARGE'); }
      chunks.push(part.value);
    }
    let value;
    diagnostics.stage = 'response-json';
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('OUTPUT_SCHEMA_INVALID'); }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AppError('OUTPUT_SCHEMA_INVALID');
    options.metadata.actualModel = typeof value.model === 'string' && /^[a-zA-Z0-9._:/-]{1,128}$/.test(value.model) && !value.model.includes(options.key) ? value.model : null;
    const count = (n: unknown): number | null => Number.isSafeInteger(n) && (n as number) >= 0 ? n as number : null;
    options.metadata.usage = value.usage ? { promptTokens: count(value.usage.prompt_tokens), completionTokens: count(value.usage.completion_tokens), totalTokens: count(value.usage.total_tokens) } : null;
    const finishReason = value.choices?.[0]?.finish_reason;
    diagnostics.finishReason = ['stop', 'length', 'content_filter', 'tool_calls'].includes(finishReason) ? finishReason : null;
    diagnostics.stage = 'finish-reason';
    if (finishReason !== 'stop' || typeof value.choices[0].message?.content !== 'string') throw new AppError('OUTPUT_SCHEMA_INVALID');
    try {
      diagnostics.stage = 'content-json';
      const content = JSON.parse(value.choices[0].message.content);
      diagnostics.stage = 'candidate-schema';
      const parsed = parseCandidateOutput(content);
      diagnostics.stage = 'validated'; return parsed;
    } catch (error) {
      if (error instanceof CandidateSchemaError) {
        const safeWords = new Set('root schemaVersion candidates warnings amountFen occurredDate occurredTime timePrecision name merchant categoryId transactionKind amountBasis groupKey lineItems evidence missingFields confidence field text region source x y width height evidenceIndexes code message'.split(' '));
        diagnostics.issues = error.issues.slice(0, 20).map((issue) => {
          const at = issue.lastIndexOf(':'); const p = issue.slice(0, at); const code = issue.slice(at + 1);
          const words = p.replace(/\[\d+\]/g, '').split('.');
          return { path: words.every((word) => safeWords.has(word)) ? p.slice(0, 180) : 'root', code: /^[A-Z_0-9]{1,50}$/.test(code) ? code : 'SCHEMA_INVALID' };
        });
      }
      throw new AppError('OUTPUT_SCHEMA_INVALID');
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(abort.signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
  } finally { clearTimeout(timer); }
}
