# S09 当天官方来源复核

查阅日期：2026-10-21（Asia/Shanghai）。来源声明与真实调用证据分开。

| 来源 | 当天确认及本次采用 |
|---|---|
| [Vision](https://api-docs.deepseek.com/guides/vision/) | deepseek-flash支持图文；Chat Completions的user内容可放image_url/data URL。本次发送26450字节PNG内联，非只发图片路径/文本。保留本地10MiB更严限制；不实现Files API |
| [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) | response_format.type=json_object；提示中有json及完整结构例子；合理max_tokens，空/截断仍须拒绝。JSON合法不等于bk-candidate.v1合法 |
| [更新记录](https://api-docs.deepseek.com/updates/) | 最近2026-10-17：官方模型更新名DeepSeek-V4.1-Flash-1017，调用别名deepseek-flash不变。9/10已用原生多模态Flash承接旧名。实测响应仅为deepseek-flash，不虚构更具体内部版本 |
| [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) | thinking.type=disabled关闭默认思考。本次不额外设置temperature/top_p，不添加搜索、工具或训练参数 |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | 主进程API；Windows同步接口用DPAPI绑定用户，防其他用户读取，不承诺防同用户其他应用。加密不可用仅会话，不明文回退。系统调用使用项目已锁Electron44.9.1，无新依赖 |

实际支持：三次均HTTP200，第二次JSON解析成功但契约缺失字段枚举失败；第三次相同图片+json_object参数组合，提示词v2通过schema、归一化及三个可见字段真值核对。不据此宣称其它组合、模型、业务截图或总体准确率通过。
