import { describe, expect, it } from 'vitest';
import { evaluateSender, type SenderFacts } from '../../src/main/security/sender';
import { APP_ORIGIN } from '../../src/shared/constants';

const BASE: SenderFacts = {
  frameUrl: `${APP_ORIGIN}/index.html`,
  parentFrameUrl: null,
  senderId: 7,
  expectedSenderId: 7,
  allowedOrigins: [APP_ORIGIN],
};

describe('IPC 发送方校验', () => {
  it('接受主窗口顶层 frame', () => {
    expect(evaluateSender(BASE)).toEqual({ ok: true, origin: APP_ORIGIN });
  });

  it('拒绝其他窗口/其他 webContents', () => {
    expect(evaluateSender({ ...BASE, senderId: 8 })).toEqual({
      ok: false,
      reason: 'SENDER_NOT_MAIN_WINDOW',
    });
    expect(evaluateSender({ ...BASE, expectedSenderId: -1 })).toEqual({
      ok: false,
      reason: 'SENDER_NOT_MAIN_WINDOW',
    });
  });

  it('拒绝 iframe 等子 frame', () => {
    expect(evaluateSender({ ...BASE, parentFrameUrl: `${APP_ORIGIN}/index.html` })).toEqual({
      ok: false,
      reason: 'SENDER_IS_CHILD_FRAME',
    });
  });

  it('拒绝陌生来源、about:blank 与 data: 页面', () => {
    for (const url of ['https://evil.example/x', 'about:blank', 'data:text/html,<h1>x</h1>', 'file:///C:/x.html']) {
      expect(evaluateSender({ ...BASE, frameUrl: url })).toEqual({
        ok: false,
        reason: 'SENDER_ORIGIN_NOT_ALLOWED',
      });
    }
  });

  it('开发模式只允许 dev server 来源', () => {
    const devOrigin = 'http://127.0.0.1:5273';
    expect(
      evaluateSender({
        ...BASE,
        frameUrl: `${devOrigin}/`,
        allowedOrigins: [devOrigin],
      }),
    ).toEqual({ ok: true, origin: devOrigin });
    expect(
      evaluateSender({
        ...BASE,
        frameUrl: `${devOrigin}/`,
        allowedOrigins: [APP_ORIGIN],
      }).ok,
    ).toBe(false);
  });
});
