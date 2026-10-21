# S09 实现自测与真实探针证据

本会话由同一Codex实现、修复和自测；没有执行S08/S17/S19验收，不声称不同作者独立审查。环境：Windows10 19045 x64，项目锁定Electron44.9.1、SQLite原生模块；指定PowerShell7.6.7 Core/UTF-8。Browser plugin not available；使用已有Playwright Electron，未安装新依赖。

测试流：设置→输入合成密钥→真实受限IPC→Windows DPAPI→提交即清空→重启→解密布尔核验→过期CAS拒绝→移除→会话模式→重启失效→无key手工页可用。用隔离LOCALAPPDATA，不把合成测试密钥发送真实API。

页面身份bookkeep://app/index.html、BookKeepAI；非空、无Vite覆盖层。1280×1000与640×600定向检查。最终UI报告记录页面错误0；已知frame-ancestors meta提示按原BK-S07-004单列交S15，不谎称控制台全无消息。截图为工作区外合成配置页，不含用户正在输入的真实密钥。

首轮UI采集在缩小视口后没有先展开导航/恢复视口，点击隐藏导航超时；原日志/JSON保留。更正采集器恢复1280宽度再操作，重跑通过；没有修改产品导航来迎合采集。首轮CSP既有提示也保留，后续按确切文案分类。

最后视觉复核发现小视口截图采于导航收缩动画中间；采集器补充等待document.getAnimations的finished及两帧requestAnimationFrame后重采，不修改产品CSS或导航。原截图和报告仍保留，不用瞬时截图推断稳定布局。

单元/集成：214项全部通过，含33项S09测试；mock覆盖401/403/402/400/404/422/429/503、超时、网络异常、空/坏/半分金额/截断/超限、严格schema、诊断泄漏保护、会话回放和真实图门升级条件。mock加密用随机AES测试适配器；Windows DPAPI另由真实Electron自测证明。mock结果不充当G2。

真实API：用户通过应用密码框保存本应用密钥，脚本只轮询安全configured/mode/version；不读输入、不截图、不跟踪用户输入。配置成功后受限provider.probe单次发送内置PNG。三次实际请求（两次v1失败、一次v2通过）分列real-probe-*.json，任何原响应/key/请求头/图片base64均未落盘。首次未留结构细节，第二次仅增加安全诊断仍用v1，定位missingFields UNKNOWN_FIELD，随后v2修复，无自动重试、无换模型或偷放宽schema。

G2以75e4eb46-1128-4a71-a258-4e10ee51b4ca的真实图+JSON+schema+真值匹配为准，不能以mock、HTTP200或JSON合法单独通过。首次/第二次失败证据不改写。

限制：只测一张干净合成图，不是业务截图质量评测；未测试真实401/余额不足/90秒网络故障（对应分支mock）；未测Win11/干净机、跨用户DPAPI、全缩放/人工IME/读屏、S15安全加固、正式ZIP或发布。AC07-C尚未实现/验证。
