import type { JSX } from 'react';
import type { AiSettingsView, SecretStatusView } from '../../shared/dto';
import { CONTRACT_VERSION } from '../../shared/constants';

export interface StatusBarProps {
  readonly ai: AiSettingsView | null;
  readonly secret: SecretStatusView | null;
  readonly lastError: string | null;
}

const READINESS_TEXT: Record<AiSettingsView['readiness'], string> = {
  stub: '真实识图未接入（S09）',
  needs_probe: '待真实探针验证',
  ready: '已验证',
};

const SECRET_TEXT: Record<SecretStatusView['mode'], string> = {
  absent: '未配置密钥',
  encrypted: '已加密保存',
  session: '仅本次会话',
};

export function StatusBar({ ai, secret, lastError }: StatusBarProps): JSX.Element {
  return (
    <footer className="statusbar" aria-label="运行状态">
      <span>
        <span className="status-dot" aria-hidden="true" />
        <strong>本地模式</strong> 数据保存在当前 Windows 用户目录
      </span>
      <span>
        识图服务：<strong>{ai ? READINESS_TEXT[ai.readiness] : '读取中…'}</strong>
      </span>
      <span>
        密钥：<strong>{secret ? SECRET_TEXT[secret.mode] : '读取中…'}</strong>
      </span>
      <span>
        契约：<strong>{CONTRACT_VERSION}</strong>
      </span>
      {lastError ? (
        <span>
          <span className="status-dot" data-tone="danger" aria-hidden="true" />
          {lastError}
        </span>
      ) : null}
    </footer>
  );
}
