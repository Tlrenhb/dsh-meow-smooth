# 更新日志

## 0.8.2 — 2026-10-26 — dsh 0.2.1-rc.2 适配

本版把插件适配到当前 npm `latest`（dsh 0.2.1-rc.2），逐条证据见
[docs/adapt-0.2.1-client.md](docs/adapt-0.2.1-client.md)、[docs/adapt-0.2.1-host.md](docs/adapt-0.2.1-host.md)，
端到端验证见 [verify/report.md](verify/report.md)。全部修复都保留了旧版（0.1.x）代码路径。

### 客户端修复

1. **会话 header 结构位移**（官方 0.1.7 起把 `<header>` 从槽位宿主内部挪到外部）：
   新增对偶选择器与 `headerElement()` / `titleRow()` 双形解析。受影响：⑨输入法时隐藏 header、
   ⑪手机端 header 横滑、⑱furl 态 header 让位、模式标签定位。
2. **当前会话名锚点**：当前段不再是 `nav button:disabled` 而是 `span._crumbCurrent` → 双形 + 末段兜底
   （⑨输入法悬浮 Session name 条）。
3. **消息操作行横滑（⑰）**：`[data-time-hover-root]` 自 0.1.2 起就已不存在 → 改用
   `[class*='_userRow'] > [class*='_actions']`（用户行）与 `[data-turn-tail] > [class*='_actions']`（轮尾），
   旧形保留兼容更早版本。
4. **会话跳转入口（⑫提醒卡片/通知点击）**：`ctx.sessions.open` 自 0.1.6-alpha.2 起已移除 →
   优先用官方自己在用的 `ctx.get('uiWorkspace').openSession`，旧方法兜底。
5. **模型触发器缩窄（②）**：`span:not(:first-child)` → `:not(:first-of-type)`——
   0.2.1 该按钮首个子元素是图标，原写法会把模型名一起藏掉。
6. **hero（新会话 / 空会话）态兜底（⑤⑫）**：0.2.1 官方只在 `variant === "composer"` 时渲染
   `conversation.composer.dock`，空会话页整条槽位不在 DOM → 插件的隐形 dock 从未挂载，
   "选完会话自动收起侧边栏"与"跨会话 pending 汇报"在这一态失效。现在同一隐形组件同时挂
   `conversation.composer.dock` 与 `conversation.input.right`（两处调用均幂等）。
7. 两处既有属性名笔误：`data-meow-fold-mode-expanded`（展开态模式标签点别处收不回）、
   `data-meow-settings-css` → `data-meow-smooth-settings-css`（设置页热替换删不掉旧样式表）。

### 宿主修复

1. **路由注册**改为官方同款 `ctx.effect(() => webServer.register(...))` 全生命周期写法——
   0.2.1 起重复 `(kind, path)` 注册会抛错，旧写法在热重载窗口里可能把装配打挂；
   现在注册失败只降级（`/pending` 不可用 + 告警），不影响其余能力。
2. **`approval/asked` 事件自带 `reason`**（0.2.1 新增字段）：优先用事件值，`approval/request`
   waterfall 观察者保留为旧版保底。
3. **孤儿审批 / 提问恢复**：0.2.1 的 `sessions.list()` 明确为"仅 live 会话"，重启后靠启动扫描
   恢复不到任何东西 → 新增 `session/created` 补扫，"会话重开即恢复"。
4. **权威端口**：压缩代理与通知的宿主端口改为 `webServer.port` → `getOrigin()` → `argv` 三级软取
   （profile 配置端口而非 `--port` 启动时，argv 解析会失真）。
5. `HOST_VERSION` 0.7.1 → 0.8.2（与 `package.json` 版本同步）。

### 元数据与文档

- `package.json`：版本 `0.8.1` → `0.8.2`；新增 `engines.dsh` 与 `dsh.engines.dsh`（`>=0.1.5`），
  插件市场据此显示兼容性。
- README：「兼容性」章节重写（0.2.1-rc.2 已验证 / 0.1.x 继续兼容）；「安装」补充本分支安装命令；
  新增「装完不生效 / 市场里点开关没反应」排障——dshmarket 会把关闭状态持久化在
  `.dsh-market/state.json` 的 `disabled` 列表里，每次启动重新关掉插件。
- 新增 `verify/`：手写 CDP 的端到端验证台（无 puppeteer 依赖）+ 验证报告。

### 验证

- `verify/report.md`：精简组合（17899）与真实组合镜像（17900，与用户实际 profile 同构）两栏，
  含断言 × 实例矩阵、证据片段、截图与"无法自动断言"清单。
- `node build.mjs` 通过；`tsc -p tsconfig.json` 0 错误（顺带修掉 client.ts 历史 TS2322）。