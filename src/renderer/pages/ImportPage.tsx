import { useCallback, useState, type JSX } from 'react';
import { Notice, PageHeader, Panel } from '../components/ui';
import type { MockRecognitionView, MockScenario } from '../../shared/dto';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { formatAmountFen } from '../lib/format';

interface ScenarioOption {
  readonly id: MockScenario;
  readonly label: string;
  readonly hint: string;
}

const SCENARIOS: readonly ScenarioOption[] = [
  { id: 'two-expenses', label: '两笔已支付消费', hint: '字段完整，可进入人工核对（仍不自动入账）' },
  { id: 'paid-order', label: '一单合计 + 明细', hint: '合计/明细歧义 → 阻断，不能批量批准' },
  { id: 'product-photo', label: '商品照片（无金额/日期）', hint: '缺字段 → 阻断，需人工补填' },
];

/**
 * P04 图片导入：真实导入在 S10。当前用 mock provider 演示
 * 「provider → bk-candidate.v1 校验 → 规范化 → UI」链路，全程不出网。
 */
export function ImportPage({ onError }: { readonly onError: (message: string | null) => void }): JSX.Element {
  const [scenario, setScenario] = useState<MockScenario>('two-expenses');
  const [result, setResult] = useState<MockRecognitionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runMock = useCallback(async () => {
    setBusy(true);
    setError(null);
    onError(null);
    try {
      const view = await call((api) => api.skeleton.mockRecognition({ scenario }));
      setResult(view);
    } catch (caught) {
      const message = describeError(caught);
      setError(message);
      onError(message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [onError, scenario]);

  return (
    <div className="page">
      <PageHeader
        title="图片导入"
        subtitle="JPEG/PNG/WebP，每批最多 20 张，单张不超过 10MiB、最长边 8192 像素。"
        actions={
          <button type="button" className="button" disabled title="此功能尚未实现（S10）">
            选择图片
          </button>
        }
      />

      <Notice tone="warn" title="本地模拟，不代表真实识图">
        下面的按钮只驱动内置 mock provider：不读取图片、不发送网络请求、不写入账本。真实图片识别与 JSON 组合需在 S09 用本地密钥真实验证（G2）。
      </Notice>

      <Panel
        title="mock 场景演示"
        actions={<span className="tiny">provider=mock · 确定性合成数据</span>}
      >
        <div className="field">
          <label htmlFor="mock-scenario">选择合成场景</label>
          <select
            id="mock-scenario"
            value={scenario}
            onChange={(event) => setScenario(event.target.value as MockScenario)}
          >
            {SCENARIOS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-hint">{SCENARIOS.find((option) => option.id === scenario)?.hint}</span>
        </div>
        <div className="form-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={runMock}
            disabled={busy}
            data-action="run-mock"
          >
            {busy ? '正在生成…' : '运行本地 mock 识别'}
          </button>
        </div>
        {error ? (
          <p className="notice" data-tone="danger" role="alert">
            {error}
          </p>
        ) : null}
      </Panel>

      {result ? (
        <Panel
          title="mock 输出"
          actions={
            <span className="tiny">
              {result.schemaVersion} · {result.durationMs} ms · actualModel={String(result.actualModel)}
            </span>
          }
        >
          <p className="muted">{result.note}</p>
          <table className="result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>金额</th>
                <th>日期</th>
                <th>名称</th>
                <th>分类</th>
                <th>缺失字段</th>
                <th>审核</th>
              </tr>
            </thead>
            <tbody>
              {result.candidates.map((candidate) => (
                <tr key={candidate.ordinal}>
                  <td>{candidate.ordinal + 1}</td>
                  <td className="amount">{formatAmountFen(candidate.current.amountFen)}</td>
                  <td>{candidate.current.occurredDate ?? '—'}</td>
                  <td>{candidate.current.name ?? '—'}</td>
                  <td>{candidate.current.categoryId ?? '—'}</td>
                  <td>{candidate.missingFields.join('、') || '无'}</td>
                  <td>
                    {candidate.blocking ? (
                      <span className="badge" data-tone="danger">
                        阻断
                      </span>
                    ) : (
                      <span className="badge" data-tone="primary">
                        待人工核对
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.warnings.length > 0 ? (
            <ul className="tiny">
              {result.warnings.map((warning) => (
                <li key={`${warning.code}-${warning.field ?? 'root'}`}>
                  {warning.code}：{warning.message}
                </li>
              ))}
            </ul>
          ) : null}
          <details>
            <summary className="tiny">查看结构化输出（脱敏合成数据）</summary>
            <pre className="raw-json">{JSON.stringify(result, null, 2)}</pre>
          </details>
        </Panel>
      ) : null}
    </div>
  );
}
