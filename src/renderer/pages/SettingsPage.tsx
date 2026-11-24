import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { ProbeReport } from '../../shared/probe';
import { Badge, MetaList, Notice, PageHeader, Panel } from '../components/ui';
import type { AiSettingsView, ProviderCapabilitiesView, SecretStatusView } from '../../shared/dto';
import type { NavId } from '../../shared/nav';
import { CONTRACT_VERSION } from '../../shared/constants';
import { APP_VERSION } from '../../shared/app-version';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { PrivacyPolicy } from '../components/PrivacyPolicy';
import type { ThemeSource } from '../../shared/appearance';
import { achievementController, useAchievementContent } from '../lib/achievement-controller';
import type { AchievementPreferences } from '../../shared/achievement-presentation';

export interface SettingsPageProps {
  readonly ai: AiSettingsView | null;
  readonly secret: SecretStatusView | null;
  readonly capabilities: readonly ProviderCapabilitiesView[];
  readonly onNavigate: (id: NavId) => void;
  readonly onError: (message: string | null) => void;
  readonly onAiChange: (value: AiSettingsView) => void;
  readonly onSecretChange: (value: SecretStatusView) => void;
}

const READINESS_LABEL: Record<AiSettingsView['readiness'], string> = {
  stub: '未验证连接',
  needs_probe: '待连接测试',
  ready: '已就绪',
};

const SECRET_LABEL: Record<SecretStatusView['mode'], string> = {
  absent: '尚未配置',
  encrypted: '已加密保存',
  session: '仅本次会话有效',
};

/** P07 设置：S09 安全配置与固定无隐私合成图探针。 */
export function SettingsPage({ ai: initialAi, secret: initialSecret, capabilities: initialCapabilities, onNavigate, onError, onAiChange, onSecretChange }: SettingsPageProps): JSX.Element {
  const achievements = useAchievementContent();
  const [noticeError,setNoticeError] = useState<string | null>(null);
  const changeNotices = async (value: AchievementPreferences): Promise<void> => {
    setNoticeError(null);
    try { await achievementController.applyPreferences(value); }
    catch (caught) { setNoticeError(describeError(caught)); }
  };
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [theme, setTheme] = useState<ThemeSource>('system');
  const [themeBusy, setThemeBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void call(api => api.appearance.read()).then(value => { if (!cancelled) setTheme(value); }).catch(caught => { if (!cancelled) setError(describeError(caught)); });
    return () => { cancelled = true; };
  }, []);
  const changeTheme = async (source: ThemeSource): Promise<void> => {
    setThemeBusy(true);
    try { setTheme(await call(api => api.appearance.apply(source))); }
    catch (caught) { setError(describeError(caught)); }
    finally { setThemeBusy(false); }
  };
  const [localCapabilities, setLocalCapabilities] = useState<readonly ProviderCapabilitiesView[] | null>(null);
  const capabilities = localCapabilities ?? initialCapabilities;
  const [localAi, setLocalAi] = useState<AiSettingsView | null>(null);
  const [localSecret, setLocalSecret] = useState<SecretStatusView | null>(null);
  const ai = localAi ?? initialAi;
  const secret = localSecret ?? initialSecret;
  const secretInput = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [probe, setProbe] = useState<ProbeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [status, settings] = await Promise.all([call((api) => api.settings.readStatus()), call((api) => api.settings.readAi())]);
      setLocalSecret(status); setLocalAi(settings);
      onSecretChange(status); onAiChange(settings);
      setLocalCapabilities(await Promise.all([call((api) => api.provider.capabilities({ providerId: 'deepseek' })), call((api) => api.provider.capabilities({ providerId: 'mock' }))]));
    } catch (caught) { setError(describeError(caught)); }
  }, [onAiChange, onSecretChange]);
  useEffect(() => { void refresh(); }, [refresh]);

  const submitSecret = useCallback(
    async (persistence: 'encrypted' | 'session') => {
      const value = secretInput.current?.value ?? '';
      if (secretInput.current) secretInput.current.value = '';
      if (value.length === 0) {
        setError('请先在密码框中输入密钥。');
        return;
      }
      setBusy(true);
      setError(null);
      setMessage(null);
      onError(null);
      try {
        const result = await call((api) =>
          api.settings.saveSecret({ action: 'save', expectedVersion: secret?.version ?? 0, secret: value, persistence }),
        );
        setMessage(result.mode === 'session' ? '密钥仅在本次会话保留；退出后需重新输入。' : '已为当前 Windows 用户加密保存。');
      } catch (caught) {
        const text = describeError(caught);
        setError(text);
        onError(text);
      } finally {
        // 提交后立即清空输入，无论成功失败都不保留明文。
        await refresh();
        setBusy(false);
      }
    },
    [onError, secret?.version, refresh],
  );

  const removeSecret = useCallback(async () => {
    setBusy(true);
    setError(null);
    onError(null);
    try {
      if (secretInput.current) secretInput.current.value = '';
      await call((api) => api.settings.saveSecret({ action: 'remove', expectedVersion: secret?.version ?? 0 }));
      setConfirmRemove(false);
      setMessage('已移除密钥。');
    } catch (caught) {
      const text = describeError(caught);
      setError(text);
      onError(text);
    } finally {
      await refresh();
      setBusy(false);
    }
  }, [onError, secret?.version, refresh]);

  const copyStoragePath = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText('%LOCALAPPDATA%\\BookKeepAI');
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch { /* Clipboard may be unavailable in restricted sessions. */ }
  };

  const runProbe = async () => {
    setBusy(true); setError(null); setProbe(null); setMessage(null);
    try {
      const report = await call((api) => api.provider.probe({ fixtureId: 's09-receipt-v1', uploadConsent: true, possibleChargeAccepted: true }));
      setProbe(report);
      setMessage(report.passed ? '真实图片、JSON、契约与可见字段均通过。' : `真实探针未通过：${report.errorCode ?? 'PROVIDER_NOT_READY'}`);
    } catch (caught) { setError(describeError(caught)); }
    finally { await refresh(); setBusy(false); }
  };

  return (
    <div className="page">
      <PageHeader title="设置" subtitle="AI 服务、本地数据与隐私" />

      <Panel title="外观">
        <div className="field">
          <label htmlFor="appearance-theme">界面主题</label>
          <select id="appearance-theme" value={theme} disabled={themeBusy} onChange={event => void changeTheme(event.target.value as ThemeSource)} aria-describedby="appearance-hint">
            <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
          </select>
          <span id="appearance-hint" className="field-hint">默认跟随系统，可随时切换；选择会自动保存在本机。</span>
        </div>
      </Panel>

      <Panel title="成就提示">
        {achievements.preferences ? <>
          <label className="achievement-preference"><input id="achievement-notices-enabled" type="checkbox" checked={achievements.preferences.enabled} disabled={achievements.saving}
            onChange={event => void changeNotices({...achievements.preferences!,enabled:event.target.checked})}/>显示成就提示</label>
          {achievements.preferences.enabled ? <>
            <div className="field"><label htmlFor="achievement-notices-position">提示位置</label>
              <select id="achievement-notices-position" value={achievements.preferences.position} disabled={achievements.saving}
                onChange={event => void changeNotices({...achievements.preferences!,position:event.target.value as AchievementPreferences['position']})}>
                <option value="center">中央（默认）</option><option value="bottom-right">右下角</option>
              </select>
            </div>
            <div className="form-actions"><button type="button" className="button" disabled={achievements.saving} onClick={achievementController.preview}>预览效果</button></div>
          </> : null}
          <p className="field-hint">选择自动保存在本机。关闭提示不影响成就解锁，重新开启也不会补弹旧提示。</p>
        </> : <p role="status">正在读取提示偏好…</p>}
        {noticeError ? <p role="alert" className="error-line">保存失败：{noticeError}</p> : null}
      </Panel>

      <Panel title="AI 服务" actions={<Badge tone={ai?.readiness === 'ready' ? 'primary' : 'warn'}>{ai ? READINESS_LABEL[ai.readiness] : '读取中…'}</Badge>}>
        <MetaList
          entries={[
            ['服务商', ai?.provider ?? '—'],
            ['模型', ai?.model ?? '—'],
          ]}
        />
        <Notice>
          可在“AI 记账”中导入消费截图，识别结果经你逐笔核对后才会入账。不配置 AI 也可完整使用手工记账。
        </Notice>
        <details className="subtle-disclosure">
          <summary>技术信息</summary>
          <MetaList
            entries={[
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
        </details>
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
            ref={secretInput}
            disabled={busy}
            placeholder={secret?.configured ? '输入新密钥以替换当前配置' : '请输入 DeepSeek API 密钥'}
            aria-describedby="secret-hint"
          />
          <span className="field-hint" id="secret-hint">
            提交后立即清空输入框，已保存的密钥不会回显。
          </span>
        </div>
        <div className="form-actions">
          {secret?.encryptionAvailable !== false ? (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void submitSecret('encrypted')}
              disabled={busy}
            >
              保存到本机加密存储
            </button>
          ) : null}
          <button
            type="button"
            className={secret?.encryptionAvailable === false ? 'button button-primary' : 'button'}
            onClick={() => void submitSecret('session')}
            disabled={busy}
          >
            仅本次会话
          </button>
          {secret?.configured ? (
            confirmRemove ? (
              <>
                <button type="button" className="button button-danger" onClick={() => void removeSecret()} disabled={busy}>
                  确认移除密钥
                </button>
                <button type="button" className="button" onClick={() => setConfirmRemove(false)} disabled={busy}>
                  取消
                </button>
              </>
            ) : (
              <button type="button" className="button button-danger-ghost" onClick={() => setConfirmRemove(true)} disabled={busy}>
                移除密钥
              </button>
            )
          ) : null}
        </div>
        {message ? <p className="notice" role="status">{message}</p> : null}
        {error ? (
          <p className="notice" data-tone="danger" role="alert">
            {error}
          </p>
        ) : null}
        {secret && !secret.encryptionAvailable ? (
          <p className="tiny">当前系统暂不支持加密存储，密钥仅在本次会话保留。</p>
        ) : null}
        {secret?.lastErrorCode ? <p role="alert" className="error-line">已存密钥无法读取，请移除后重新配置：{secret.lastErrorCode}</p> : null}
      </Panel>

      <Panel title="连接测试">
        <p className="muted">发送一张程序内置的无隐私测试图，验证 API 密钥与识图服务是否正常可用（不会上传账本，也不会入账）。</p>
        {!secret?.configured ? (
          <p className="tiny">请先在上方配置 API 密钥，再运行连接测试。</p>
        ) : (
          <>
            <label className="check-row"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} />我同意发送内置测试图并了解可能产生少量 API 费用</label>
            <div className="form-actions"><button type="button" className="button button-primary" disabled={busy || !consent} onClick={() => void runProbe()}>{busy ? '正在测试连接…' : '测试识图连接'}</button></div>
          </>
        )}
        {probe ? <details className="subtle-disclosure" open><summary>测试结果</summary><pre className="raw-json" data-probe-result>{JSON.stringify(probe, null, 2)}</pre></details> : null}
      </Panel>

      <Panel title="本地数据">
        <div className="storage-path-row">
          <span>存储位置：<code className="storage-location">%LOCALAPPDATA%\BookKeepAI</code></span>
          <button type="button" className="button button-small" onClick={() => void copyStoragePath()}>{copiedPath ? '已复制' : '复制路径'}</button>
        </div>
        <p className="muted">
          账本、附件、备份与日志均保存在当前 Windows 用户目录下，与程序文件分离；移动或更新程序不会丢失账本。
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
            ['应用', `BookKeepAI ${APP_VERSION}`],
            ['发行者', '瀚宇铭'],
            ['第三方许可', 'Electron / React / Lucide（ISC + MIT）等，见随包 licenses 目录'],
          ]}
        />
        <details className="subtle-disclosure">
          <summary>版本与契约信息</summary>
          <MetaList entries={[['契约版本', CONTRACT_VERSION], ['AI 状态', '实验性：真实识别质量需结合实际使用核对']]} />
        </details>
        <button type="button" className="privacy-link" onClick={() => setPrivacyOpen(true)}>隐私政策</button>
      </Panel>
      {privacyOpen ? <PrivacyPolicy onClose={() => setPrivacyOpen(false)} /> : null}
    </div>
  );
}
