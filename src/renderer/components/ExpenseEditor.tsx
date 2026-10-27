import { useEffect, useRef, useState, type JSX } from 'react';
import type { CategoryView, TransactionView } from '../../shared/entities';
import { todayInShanghai } from '../../shared/date';
import { call, errorCodeOf } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { expenseDraft, MutationAttempt, validateExpense, type ExpenseDraft } from '../lib/ledger';
import { Modal } from './Modal';

export type LeaveGuard = ((leave: () => void) => void) | null;

export function ExpenseEditor({ original, categories, dataEpoch, onSaved, onClose, onRefresh, registerGuard }: {
  original: TransactionView | null; categories: CategoryView[];
  dataEpoch: string;
  onSaved: (value: TransactionView) => void; onClose: () => void;
  onRefresh: () => Promise<void>; registerGuard: (guard: LeaveGuard) => void;
}): JSX.Element {
  const [base, setBase] = useState(original);
  const [draft, setDraft] = useState(() => expenseDraft(original));
  const initial = useRef(JSON.stringify(expenseDraft(original)));
  const [errors, setErrors] = useState<Partial<Record<keyof ExpenseDraft, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [epochChanged, setEpochChanged] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<TransactionView | null>(null);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const [futureConfirmed, setFutureConfirmed] = useState(false);
  const attempt = useRef(new MutationAttempt());
  const form = useRef<HTMLFormElement>(null);
  const dirty = JSON.stringify(draft) !== initial.current || uncertain;

  function requestLeave(leave: () => void): void {
    if (saving.current) return;
    if (dirty) setLeaveAction(() => leave);
    else leave();
  }
  useEffect(() => { registerGuard(requestLeave); return () => registerGuard(null); });
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (dirty || saving.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function change<K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    if (key === 'date') setFutureConfirmed(false);
  }
  async function refreshConflict(): Promise<void> {
    await onRefresh();
    if (!base) return;
    let page = await call((api) => api.transaction.list({ filter: { dateStart: null, dateEnd: null, nameQuery: null, categoryIds: [], deleted: 'all' }, page: { limit: 100, cursor: null } }));
    let found = page.items.find((item) => item.id === base.id);
    while (!found && page.nextCursor) {
      page = await call((api) => api.transaction.list({ filter: page.filterEcho, page: { limit: 100, cursor: page.nextCursor } }));
      found = page.items.find((item) => item.id === base.id);
    }
    setLatest(found ?? null);
  }
  async function save(afterSave?: () => void): Promise<void> {
    if (saving.current || epochChanged || conflict) return;
    const validated = validateExpense(draft, categories, base);
    setErrors(validated.errors);
    const input = validated.input;
    if (!input) {
      form.current?.querySelector<HTMLElement>(`[name="${Object.keys(validated.errors)[0]}"]`)?.focus();
      return;
    }
    if (draft.date > todayInShanghai() && !futureConfirmed) {
      setError('所选日期在未来，当前周期统计尚不计入。请勾选核实日期后保存。'); return;
    }
    const payload = base ? { id: base.id, expectedVersion: base.version, patch: input } : input;
    const mutationId = attempt.current.forPayload({ dataEpoch, payload });
    saving.current = true; setBusy(true); setError(null);
    try {
      const result = await call((api) => base
        ? api.transaction.update({ id: base.id, expectedVersion: base.version, patch: input }, { mutationId, dataEpoch })
        : api.transaction.create(input, { mutationId, dataEpoch }));
      setUncertain(false); onSaved(result.transaction); afterSave?.();
    } catch (failure) {
      const code = errorCodeOf(failure);
      setError(describeError(failure));
      if (code === 'STALE_EPOCH') {
        setEpochChanged(true);
        setError('账本已恢复或切换，请关闭此表单，核对新账本后重新编辑；原输入保留供对照。');
        await onRefresh();
      } else if (code === 'VERSION_CONFLICT' || code === 'TRANSACTION_DELETED') {
        setConflict(true);
        setError('记录已被修改。请查看最新内容后重新保存。您的输入已保留。');
        await refreshConflict().catch((readError: unknown) => setError(describeError(readError)));
      } else {
        // 明确领域拒绝可修正；不确定响应期间冻结载荷，原键重试核实。
        setUncertain(!['AMOUNT_INVALID', 'DATE_INVALID', 'FIELD_INVALID', 'PAYLOAD_INVALID', 'CATEGORY_DISABLED', 'NOT_FOUND', 'STATE_CONFLICT'].includes(code));
        if (code === 'CATEGORY_DISABLED') await onRefresh();
      }
    } finally { saving.current = false; setBusy(false); }
  }
  const fieldError = (key: keyof ExpenseDraft): JSX.Element | null => errors[key]
    ? <span className="field-error" id={`expense-${key}-error`}>{errors[key]}</span> : null;
  const labels: Partial<Record<keyof ExpenseDraft, string>> = { amount: '金额（元，必填）', date: '日期（必填）', name: '购买物或服务名称（必填）', categoryId: '消费分类（必填）', time: '时刻', merchant: '商户（选填）', note: '备注（选填）' };
  const attrs = (key: keyof ExpenseDraft) => ({ name: key, id: `expense-${key}`, 'aria-label': labels[key], 'aria-invalid': !!errors[key], 'aria-describedby': errors[key] ? `expense-${key}-error` : undefined });

  return <>
    <Modal title={base ? '编辑支出' : '记一笔'} onClose={() => requestLeave(onClose)} busy={busy}>
      <form ref={form} noValidate onSubmit={(event) => { event.preventDefault(); void save(); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); void save(); }
        else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
      }}>
        <p className="muted">默认账本 · 人民币 · 上海时间</p>
        {base ? <p className="tiny">来源：{base.source === 'manual' ? '手工记账' : 'AI审核入账'}{base.sourceCandidateId ? ` · 候选 ${base.sourceCandidateId}` : ''}</p> : null}
        <fieldset disabled={busy || uncertain || epochChanged || conflict} className="expense-fields">
          <label className="field" htmlFor="expense-amount">金额（元，必填）<input {...attrs('amount')} type="text" inputMode="decimal" autoFocus value={draft.amount} onChange={(event) => change('amount', event.target.value)} placeholder="0.00" />{fieldError('amount')}</label>
          <label className="field" htmlFor="expense-date">日期（必填）<input {...attrs('date')} type="date" min="1900-01-01" max="9998-12-31" value={draft.date} onChange={(event) => change('date', event.target.value)} />{fieldError('date')}</label>
          <label className="field expense-wide" htmlFor="expense-name">购买物或服务名称（必填）<input {...attrs('name')} type="text" value={draft.name} onChange={(event) => change('name', event.target.value)} />{fieldError('name')}</label>
          <label className="field expense-wide" htmlFor="expense-categoryId">消费分类（必填）<select {...attrs('categoryId')} value={draft.categoryId} onChange={(event) => change('categoryId', event.target.value)}>
            <option value="">请选择消费分类</option>{categories.filter((item) => item.enabled || item.id === base?.categoryId).map((item) => <option key={item.id} value={item.id}>{item.name}{item.enabled ? '' : '（已停用，可原样保留）'}</option>)}
          </select>{fieldError('categoryId')}</label>
          <label className="expense-wide"><input type="checkbox" checked={draft.knownTime} onChange={(event) => change('knownTime', event.target.checked)} /> 记录精确时间（不选则仅日期，时间未知）</label>
          {draft.knownTime ? <label className="field" htmlFor="expense-time">时刻<input {...attrs('time')} type="time" value={draft.time} onChange={(event) => change('time', event.target.value)} />{fieldError('time')}</label> : null}
          <label className="field expense-wide" htmlFor="expense-merchant">商户（选填）<input {...attrs('merchant')} value={draft.merchant} onChange={(event) => change('merchant', event.target.value)} />{fieldError('merchant')}</label>
          <label className="field expense-wide" htmlFor="expense-note">备注（选填）<textarea {...attrs('note')} rows={3} value={draft.note} onChange={(event) => change('note', event.target.value)} />{fieldError('note')}</label>
        </fieldset>
        {draft.date > todayInShanghai() ? <label className="future-confirm"><input type="checkbox" disabled={busy || uncertain || epochChanged} checked={futureConfirmed} onChange={(event) => setFutureConfirmed(event.target.checked)} /> 所选日期在未来，当前周期统计尚不计入。我已核实日期。</label> : null}
        {error ? <p role="alert" className="error-line">{error}</p> : null}
        {uncertain ? <p className="tiny">保存结果尚未确认。请重试保存核实原提交，重试不会重复记账；核实前暂时锁定输入。</p> : null}
        {conflict ? <div className="conflict-review"><p>最新记录：{latest ? `${latest.name} · ${expenseDraft(latest).amount}元 · ${latest.occurredDate}${latest.deletedAt ? '（已删除）' : ''}` : '暂未读到，请重新读取。'}</p>
          <button type="button" className="button" disabled={busy} onClick={() => void refreshConflict().catch((failure: unknown) => setError(describeError(failure)))}>重新读取最新记录</button>
          {latest && !latest.deletedAt ? <button type="button" className="button" onClick={() => { setBase(latest); attempt.current.reset(); setConflict(false); setUncertain(false); setError('已采用最新版本，请复核保留的输入后保存。'); }}>已核对最新记录，保留我的输入继续编辑</button> : null}
        </div> : null}
        <div className="expense-actions"><button className="button" type="button" disabled={busy} onClick={() => requestLeave(onClose)}>取消</button><button className="button button-primary" type="submit" disabled={busy || epochChanged || conflict}>{busy ? '正在保存…' : uncertain ? '重试保存' : '保存支出'}</button></div>
      </form>
    </Modal>
    {leaveAction ? <Modal title="有未保存的修改" busy={busy} onClose={() => setLeaveAction(null)}>
      <p>{uncertain ? '原提交结果尚未核实，请先重试保存。放弃输入不会撤销可能已提交的交易。' : '选择保存后离开，或放弃本次修改。'}</p>
      <div className="expense-actions"><button className="button" disabled={busy} onClick={() => setLeaveAction(null)}>继续编辑</button><button className="button" disabled={busy} onClick={() => { const leave = leaveAction; setLeaveAction(null); onClose(); if (leave !== onClose) leave(); }}>放弃修改</button><button className="button button-primary" disabled={busy || epochChanged || conflict} onClick={() => { const leave = leaveAction; setLeaveAction(null); void save(leave); }}>保存并离开</button></div>
    </Modal> : null}
  </>;
}
