import { useCallback, useEffect, useState, type JSX } from 'react';
import { EmptyState, ErrorLine, Notice, PageHeader, Panel } from '../components/ui';
import { AppIcon } from '../lib/icon-registry';
import { call } from '../lib/bridge';
import { describeError } from '../lib/messages';
import { CATEGORY_ICON_SLUGS } from '../../shared/icons';
import type { CategoryView } from '../../shared/entities';

const ICON_OPTIONS = CATEGORY_ICON_SLUGS.map((slug) => `lucide:${slug}`);
const DEFAULT_ICON = ICON_OPTIONS[0] ?? 'lucide:utensils';

/**
 * P02 分类：读取真实数据库分类；支持新建、改名/换图标/排序、停用与重新启用。
 * 名称/图标/上限/保护由主进程校验；“其他”按身份保护不能被前端绕过。
 */
export function CategoriesPage(): JSX.Element {
  const [categories, setCategories] = useState<CategoryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftIcon, setDraftIcon] = useState(DEFAULT_ICON);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState(DEFAULT_ICON);

  const load = useCallback(async (): Promise<void> => {
    setPending(true);
    try {
      const result = await call((api) => api.category.list({ includeDisabled: true }));
      setCategories(result.categories);
    } catch (loadError) {
      setError(describeError(loadError));
    } finally {
      setPending(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string | null = null): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
      return true;
    } catch (actionError) {
      setError(describeError(actionError));
      return false;
    } finally {
      setPending(false);
    }
  }

  const create = async (): Promise<void> => {
    const ok = await run(
      () => call((api) => api.category.create({ name: draftName, iconKey: draftIcon })),
      '已新建分类。',
    );
    if (ok) {
      setDraftName('');
      setDraftIcon(DEFAULT_ICON);
    }
  };

  const startEdit = (category: CategoryView): void => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditIcon(category.iconKey);
  };

  const saveEdit = async (category: CategoryView): Promise<void> => {
    const ok = await run(
      () =>
        call((api) =>
          api.category.update({
            id: category.id,
            expectedVersion: category.version,
            patch: { name: editName, iconKey: editIcon },
          }),
        ),
      '已保存分类。',
    );
    if (ok) setEditingId(null);
  };

  const disable = async (category: CategoryView): Promise<void> => {
    if (
      !window.confirm(
        `停用“${category.name}”？停用后，新支出不可选用；历史记录和统计保留。`,
      )
    ) {
      return;
    }
    await run(
      () =>
        call((api) =>
          api.category.disable({ id: category.id, expectedVersion: category.version }),
        ),
      '已停用分类，历史记录不受影响。',
    );
  };

  const enable = async (category: CategoryView): Promise<void> => {
    await run(
      () =>
        call((api) =>
          api.category.update({
            id: category.id,
            expectedVersion: category.version,
            patch: { enabled: true },
          }),
        ),
      '已重新启用分类。',
    );
  };

  const move = async (category: CategoryView, offset: -1 | 1): Promise<void> => {
    const list = (categories ?? []).filter((item) => item.enabled);
    const index = list.findIndex((item) => item.id === category.id);
    const neighbor = list[index + offset];
    if (!neighbor) return;
    await run(async () => {
      await call((api) =>
        api.category.update({
          id: category.id,
          expectedVersion: category.version,
          patch: { sortOrder: neighbor.sortOrder },
        }),
      );
      await call((api) =>
        api.category.update({
          id: neighbor.id,
          expectedVersion: neighbor.version,
          patch: { sortOrder: category.sortOrder },
        }),
      );
    }, '已调整排序。');
  };

  const normalizedQuery = query.trim();
  const matches = (category: CategoryView): boolean =>
    normalizedQuery.length === 0 || category.name.includes(normalizedQuery);
  const enabled = (categories ?? []).filter((category) => category.enabled && matches(category));
  const disabled = (categories ?? []).filter((category) => !category.enabled && matches(category));
  const total = categories?.length ?? 0;

  return (
    <div className="page">
      <PageHeader
        title="分类"
        subtitle={`共 ${total || '…'} 个分类（初始 33 个消费分类 + “其他”）；“设置”是导航入口，不是分类。`}
      />

      {error ? <ErrorLine message={error} /> : null}
      {notice ? <Notice title="已保存">{notice}</Notice> : null}

      <Panel title="新建自定义分类" actions={<span className="tiny">本地图标白名单；最多 500 个（含停用）</span>}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="category-draft-name">分类名称</label>
            <input
              id="category-draft-name"
              type="text"
              value={draftName}
              maxLength={20}
              placeholder="1～20 字，例如：早餐"
              onChange={(event) => setDraftName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="category-draft-icon">图标</label>
            <div className="icon-picker">
              <AppIcon iconKey={draftIcon} size={20} />
              <select
                id="category-draft-icon"
                value={draftIcon}
                onChange={(event) => setDraftIcon(event.target.value)}
              >
                {ICON_OPTIONS.map((iconKey) => (
                  <option key={iconKey} value={iconKey}>
                    {iconKey.replace('lucide:', '')}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={pending || draftName.trim().length === 0}
              onClick={() => void create()}
            >
              新建分类
            </button>
          </div>
        </div>
        <p className="tiny">自定义分类使用 UUID；改名/换图标/排序不改分类 ID，旧交易与统计关联保持不变。</p>
      </Panel>

      <Panel
        title="启用中的分类"
        actions={
          <label className="search-field">
            <span className="tiny">搜索分类</span>
            <input
              type="text"
              value={query}
              maxLength={20}
              placeholder="输入名称"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        }
      >
        {categories === null ? (
          <EmptyState title="正在读取分类…">数据来自本地账本数据库。</EmptyState>
        ) : enabled.length === 0 ? (
          <EmptyState title="没有找到分类">可新建或清空搜索。</EmptyState>
        ) : (
          <div className="category-grid">
            {enabled.map((category) => (
              <div key={category.id} className="category-card" data-category-id={category.id}>
                <span className="category-icon">
                  <AppIcon iconKey={editingId === category.id ? editIcon : category.iconKey} size={20} />
                </span>
                {editingId === category.id ? (
                  <div className="category-edit">
                    <label className="tiny" htmlFor={`category-name-${category.id}`}>
                      名称
                    </label>
                    <input
                      id={`category-name-${category.id}`}
                      type="text"
                      value={editName}
                      maxLength={20}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                    <select
                      aria-label={`图标 ${category.name}`}
                      value={editIcon}
                      onChange={(event) => setEditIcon(event.target.value)}
                    >
                      {ICON_OPTIONS.map((iconKey) => (
                        <option key={iconKey} value={iconKey}>
                          {iconKey.replace('lucide:', '')}
                        </option>
                      ))}
                    </select>
                    <div className="category-actions">
                      <button
                        type="button"
                        className="button button-small button-primary"
                        disabled={pending}
                        onClick={() => void saveEdit(category)}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="button button-small"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="category-meta">
                      <div className="category-name">
                        {category.name}
                        {category.protected ? <span className="tiny">（受保护）</span> : null}
                        <span className="badge">v{category.version}</span>
                      </div>
                      <div className="category-id" title={category.id}>
                        {category.id}
                      </div>
                    </div>
                    <div className="category-actions">
                      <button
                        type="button"
                        className="button button-small"
                        onClick={() => startEdit(category)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="button button-small"
                        disabled={category.protected || pending}
                        title={category.protected ? '系统“其他”分类不能停用' : '停用后历史记录保留'}
                        onClick={() => void disable(category)}
                      >
                        停用
                      </button>
                      <button
                        type="button"
                        className="button button-small"
                        aria-label={`上移 ${category.name}`}
                        onClick={() => void move(category, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="button button-small"
                        aria-label={`下移 ${category.name}`}
                        onClick={() => void move(category, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="已停用分类" actions={<span className="tiny">停用项仍占用名称，可重新启用</span>}>
        {categories === null ? null : disabled.length === 0 ? (
          <EmptyState title="暂无停用分类" />
        ) : (
          <ul className="simple-list">
            {disabled.map((category) => (
              <li key={category.id}>
                <span className="category-icon">
                  <AppIcon iconKey={category.iconKey} size={20} />
                </span>
                <span className="category-name">{category.name}</span>
                <span className="category-id">{category.id}</span>
                <button
                  type="button"
                  className="button button-small"
                  disabled={pending}
                  onClick={() => void enable(category)}
                >
                  启用
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
