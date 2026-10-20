/**
 * IPC 路由：发送方校验 → 信封/载荷校验 → 业务处理 → 统一信封。
 * 任何异常都转换为安全错误对象，未知异常不泄漏栈、SQL、路径或原始响应。
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION } from '../../shared/constants';
import type { EnvelopeBase } from '../../shared/envelope';
import { buildErrorEnvelope, buildOkEnvelope } from '../../shared/envelope';
import { AppError, type AppErrorPayload } from '../../shared/errors';
import type { ChannelSpec } from '../../shared/ipc';
import { evaluateSender } from '../security/sender';
import { validateIpcRequest, type ValidatedRequest } from './validate-request';

export interface RouterContext {
  /** 允许的渲染层来源（开发服务器或 bookkeep://app）。 */
  readonly expectedOrigins: readonly string[];
  /** 主窗口 webContents.id；窗口未创建时返回 null。 */
  readonly getSenderWebContentsId: () => number | null;
  /** 当前数据世代；S04 无数据库恒为 null。 */
  readonly dataEpoch: string | null;
  readonly dataRevision: number;
  readonly onRejectedSender?: (reason: string) => void;
  readonly onInternalError?: (error: unknown) => void;
}

export type IpcHandler<TPayload, TResult> = (
  request: ValidatedRequest<TPayload>,
) => Promise<TResult> | TResult;

export interface IpcRouter {
  handle<TPayload, TResult>(spec: ChannelSpec<TPayload>, handler: IpcHandler<TPayload, TResult>): void;
  registeredChannels(): readonly string[];
  dispose(): void;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requestIdOf(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const candidate = (raw as Record<string, unknown>).requestId;
    if (typeof candidate === 'string' && UUID_V4.test(candidate)) return candidate;
  }
  return randomUUID();
}

function toErrorPayload(error: unknown, onInternalError?: (error: unknown) => void): AppErrorPayload {
  if (error instanceof AppError) return error.toPayload();
  onInternalError?.(error);
  return new AppError('INTERNAL_ERROR', { details: { reason: 'UNEXPECTED_FAILURE' } }).toPayload();
}

function senderFacts(event: IpcMainInvokeEvent, context: RouterContext) {
  let frameUrl = '';
  let parentFrameUrl: string | null = null;
  try {
    frameUrl = event.senderFrame?.url ?? '';
    parentFrameUrl = event.senderFrame?.parent?.url ?? null;
  } catch {
    // frame 已销毁：按不可信处理。
    frameUrl = '';
  }
  return {
    frameUrl,
    parentFrameUrl,
    senderId: event.sender.id,
    expectedSenderId: context.getSenderWebContentsId() ?? -1,
    allowedOrigins: context.expectedOrigins,
  };
}

export function createIpcRouter(context: RouterContext): IpcRouter {
  const registered: string[] = [];

  return {
    handle<TPayload, TResult>(spec: ChannelSpec<TPayload>, handler: IpcHandler<TPayload, TResult>): void {
      ipcMain.handle(spec.channel, async (event, raw): Promise<unknown> => {
        const base: EnvelopeBase = {
          requestId: requestIdOf(raw),
          contractVersion: CONTRACT_VERSION,
          dataEpoch: context.dataEpoch,
          dataRevision: context.dataRevision,
        };
        try {
          const decision = evaluateSender(senderFacts(event, context));
          if (!decision.ok) {
            context.onRejectedSender?.(decision.reason);
            throw new AppError('PERMISSION_DENIED', { details: { reason: decision.reason } });
          }
          const request = validateIpcRequest(spec, raw, { expectedEpoch: context.dataEpoch });
          const data = await handler(request);
          return buildOkEnvelope(base, data);
        } catch (error) {
          return buildErrorEnvelope(base, toErrorPayload(error, context.onInternalError));
        }
      });
      registered.push(spec.channel);
    },

    registeredChannels(): readonly string[] {
      return [...registered];
    },

    dispose(): void {
      for (const channel of registered) {
        ipcMain.removeHandler(channel);
      }
      registered.length = 0;
    },
  };
}
