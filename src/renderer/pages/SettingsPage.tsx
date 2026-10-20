import { useCallback, useState, type JSX } from 'react';
import { Badge, MetaList, Notice, PageHeader, Panel } from '../components/ui';
import type { AiSettingsView, ProviderCapabilitiesView, SecretStatusView } from '../../shared/dto';
import type { NavId } from '../../shared/nav';
import { CONTRACT_VERSION } from '../../shared/constants';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';

export interface SettingsPageProps {
  readonly ai: AiSettingsView | null;
  readonly secret: SecretStatusView | null;
  readonly capabilities: readonly ProviderCapabilitiesView[];
  readonly onNavigate: (id: NavId) => void;
  readonly onError: (message: string | null) => void;
}

const READINESS_LABEL: Record<AiSettingsView['readiness'], string> = {
  stub: '真实识图尚未接入（S09）',
  needs_probe: '待真实探针验证',
  ready: '已验证',
};

const SECRET_LABEL: Record<SecretStatusView['mode'], string> = {
  absent: '尚未配置密钥，手工记账可用。',
  encrypted: '已为当前 Windows 用户加密保存。',
  session: '密钥仅在本次会话保留，退出后需重新输入。',
};

/** P07 设置：S04 只提供受限密钥入口与只读状态；安全存储与真实探针由 S09 实现。 */
export function SettingsPage({ ai, secret, capabilities, onNavigate, onError }: SettingsPageProps): JSX.Element {
  const [secretValue, setSecretValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitSecret = useCallback(
    async (persistence: 'encrypted' | 'session') => {
      if (secretValue.length === 0) {
        setError('请先在密码框中输入密钥。');
        return;
      }
      setBusy(true);
      setError(null);
      setMessage(null);
      onError(null);
      try {
        await call((api) =>
          api.settings.saveSecret({ action: 'save', secret: secretValue, persistence }),
        );
        setMessage('已保存安全配置。');
      } catch (caught) {
        const text = describeError(caught);
        setError(text);
        onError(text);
      } finally {
        // 提交后立即清空输入，无论成功失败都不保留明文。
        setSecretValue('');
        setBusy(false);
      }
    },
    [onError, secretValue],
  );

  const removeSecret = useCallback(async () => {
    setBusy(true);
    setError(null);
    onError(null);
    try {
      await call((api) => api.settings.saveSecret({ action: 'remove' }));
      setMessage('已移除密钥。');
    } catch (caught) {
      const text = describeError(caught);
      setError(text);
      onError(text);
    } finally {
      setBusy(false);
    }
  }, [onError]);

  return (
    <div className="page">
      <PageHeader title="设置" subtitle="AI 服务、本地数据与关于；不展示内部数据库路径或堆栈信息。" />

      <Panel title="AI 服务" actions={<Badge tone="warn">{ai ? READINESS_LABEL[ai.readiness] : '读取中…'}</Badge>}>
        <MetaList
          entries={[
            ['提供商', ai?.provider ?? '—'],
            ['配置模型名', ai?.model ?? '—'],
            ['提示词版本', ai?.promptVersion ?? '—'],
            ['候选 schema', ai?.schemaVersion ?? '—'],
          ]}
        />
        <ul className="tiny">
          {capabilities.map((capability) => (
            <li key={capability.providerId}>
              {capability.providerId}：图片 {capability.supportsImage ? '声明支持' : '不支持'} · 结构化输出{' '}
              {capability.structuredOutputStatus} · 训练提交
              {capability.trainingSubmitSupported ? '支持' : '不支持'}（{capability.adapterVersion}）
            </li>
          ))}
        </ul>
        <Notice>
          S05 不实现真实 HTTP 调用；DeepSeek 适配器返回 NOT_IMPLEMENTED，mock 结果显著标记为本地模拟。真实图片探针与 JSON 组合在 S09 用本地密钥验证。
        </Notice>
      </Panel>

      <Panel
        title="识图密钥"
        actions={
          <Badge tone={secret?.configured ? 'primary' : 'default'}>
            {secret ? SECRET_LABEL[secret.mode] : '读取中…'}
          </Badge>
        }
      >
        <div className="field">
          <label htmlFor="secret-input">API 密钥</label>
          <input
            id="secret-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={secretValue}
            placeholder="仅在提交时短暂持有，不会保存到页面状态之外"
            onChange={(event) => setSecretValue(event.target.value)}
            aria-describedby="secret-hint"
          />
          <span className="field-hint" id="secret-hint">
            提交进入受限 IPC 后立即清空；已保存的密钥不会回读到界面。
          </span>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => void submitSecret('encrypted')}
            disabled={busy}
            title="此功能尚未实现（S09）"
          >
            保存到本机加密存储
          </button>
          <button
            type="button"
            className="button"
            onClick={() => void submitSecret('session')}
            disabled={busy}
            title="此功能尚未实现（S09）"
          >
            仅本次会话
          </button>
          <button type="button" className="button" onClick={() => void removeSecret()} disabled={busy} title="此功能尚未实现（S09）">
            移除密钥
          </button>
        </div>
        {message ? <p className="tiny">{message}</p> : null}
        {error ? (
          <p className="notice" data-tone="danger" role="alert">
            {error}
          </p>
        ) : null}
        <p className="tiny">
          系统加密可用：{secret ? (secret.encryptionAvailable ? '是' : '否（将仅本次会话保留）') : '读取中…'}
        </p>
      </Panel>

      <Panel title="本地数据">
        <p className="muted">
          数据库、附件、备份与脱敏日志保存在当前 Windows 用户目录下的 BookKeepAI 文件夹，与程序解压目录分离；移动或重新解压程序不会移动账本。
        </p>
        <div className="form-actions">
          <button type="button" className="button" onClick={() => onNavigate('data')}>
            打开数据管理
          </button>
        </div>
      </Panel>

      <Panel title="关于">
        <MetaList
          entries={[
            ['应用', 'BookKeepAI 0.1.0（S05 本地账本与持久化）'],
            ['契约版本', CONTRACT_VERSION],
            ['AI 状态', '实验性：真实识别质量尚未验收'],
            ['第三方许可', 'Electron / React / Lucide（ISC + MIT）等，见随包 licenses 目录'],
          ]}
        />
      </Panel>
    </div>
  );
}
