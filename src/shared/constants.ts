/** 契约与版本常量（docs/CONTRACTS.md §1/§7；改动须先经 Codex 决策）。 */

/** IPC 契约版本，失败即 CONTRACT_VERSION_UNSUPPORTED。 */
export const CONTRACT_VERSION = 'bookkeep.v1';

/** 候选结构化输出 schema 版本（provider 输出与本地规范化共用）。 */
export const CANDIDATE_SCHEMA_VERSION = 'bk-candidate.v1';

/** 请求 DeepSeek 时使用的模型别名（真实标识只能来自响应）。 */
export const DEEPSEEK_MODEL = 'deepseek-flash';

/** S04 骨架提示词版本；真实提示词由 S09/S10 固化并替换。 */
export const PROMPT_VERSION = 'bk-prompt.v0-skeleton';

/** 本地模拟 provider 的模型标识（不是真实模型）。 */
export const MOCK_MODEL = 'mock-deterministic-v1';

/** 应用显示名。 */
export const APP_DISPLAY_NAME = 'BookKeepAI';

/** 账本固定口径（ARCHITECTURE §3.1）。 */
export const DEFAULT_CURRENCY = 'CNY';
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 通用 IPC 载荷上限（CONTRACTS §2）。 */
export const MAX_IPC_PAYLOAD_BYTES = 256 * 1024;

/** 密钥输入长度上限（CONTRACTS §6 settings.saveSecret）。 */
export const SECRET_MIN_LENGTH = 1;
export const SECRET_MAX_LENGTH = 512;

/** 分类数量上限（CONTRACTS §3）。 */
export const MAX_CATEGORIES = 500;

/** 生产环境自定义协议（本地资源，不是 http）。 */
export const APP_SCHEME = 'bookkeep';
export const APP_HOST = 'app';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
