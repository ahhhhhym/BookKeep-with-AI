import type { ErrorCode } from './errors';
export interface ProbeInput {
  fixtureId: 's09-receipt-v1';
  uploadConsent: true;
  possibleChargeAccepted: true;
}
/** Public synthetic truth only; no raw model text, key, request body or image bytes. */
export interface ProbeReport {
  id: string;
  kind: 'real-api';
  startedAt: string;
  finishedAt: string;
  requestedModel: string;
  actualModel: string | null;
  promptVersion: string;
  schemaVersion: string;
  fixtureId: string;
  imageSha256: string;
  imageBytes: number;
  imageSource: string;
  endpoint: string;
  responseFormat: 'json_object';
  imageAttached: boolean;
  requestCount: number;
  durationMs: number;
  httpStatus: number | null;
  usage: { promptTokens: number | null; completionTokens: number | null; totalTokens: number | null } | null;
  schemaValid: boolean;
  diagnostics?: { stage: string; finishReason: string | null; issues: { path: string; code: string }[] };
  matches: { amount: boolean; date: boolean; name: boolean };
  fields: { amountFen: number | null; occurredDate: string | null; name: string | null };
  passed: boolean;
  errorCode: ErrorCode | null;
}
