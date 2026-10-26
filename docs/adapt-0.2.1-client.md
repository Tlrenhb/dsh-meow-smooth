# meow-smooth 客户端（浏览器端）× dsh 0.2.1-rc.2 适配审计

> 范围：`src/client.ts`、`src/notify-client.ts`、`src/settings-mobile.ts`、`src/sidebar-gesture.ts`、
> `src/back-guard.ts`、`src/photo-picker.tsx`、`src/run-send.tsx`（host 侧四个文件见
> `docs/adapt-0.2.1-host.md`）。
> 结论先行：**7 处失效锚点/语义漂移已修**，其余 30+ 条锚点与服务在 0.2.1-rc.2 上逐条实测存在。
> 每条修复都保持"找不到就 no-op、绝不抛错"，且对 ≤0.1.6 老版本仍然可用。

---

## 1. 方法与证据来源

| 类别 | 材料 |
| --- | --- |
| 权威产物（只读） | `/opt/dsh-local/profiles/web/node_modules/@deepseek-ai/dsh-client-*/lib/client.js`（0.2.1-rc.2 浏览器包，CSS Modules 内联在同文件）、`.../dsh-client-ui-slots/lib/index.js`、`.../dsh-api-session-controller/lib/client.js`、`.../dsh-cordis-client-runner/lib/client.js`（官方 slot 契约目录） |
| 版本对照（npm 拉的 tarball，仅供比对） | `0.1.2-rc.1` / `0.1.3-alpha.2` / `0.1.5-rc.3` / `0.1.6-alpha.2` / `0.1.7-rc.2` 的 `dsh-client-ui-chat`、`dsh-client-ui-conversation`、`dsh-client-ui-model-selection`、`dsh-client-ui-subagent`、`dsh-api-session-controller` |
| 活体实测 | 测试实例 `http://127.0.0.1:17899`（`DSH_HOME=/tmp/dsh-test-home`，profile `meowtest`，`node_modules/meow-smooth -> /root/ws/meow-smooth` 软链，重建即生效）；用 `verify/cdp.mjs`（verifier 的 CDP 探针，headless chromium）在 390×844 / 1440×900 两视口 dump 真实 DOM |
| 构建/类型 | `node build.mjs`（通过）、`node_modules/.bin/tsc -p tsconfig.json`（通过，含历史错误的修复，见 §5.8） |

行号引用统一格式 `包名/lib/client.js:行`（0.2.1-rc.2）。**0.1.x 的行号随版本变化，故对照只写版本号。**

---

## 2. DOM 锚点审计表

结论列：`可用` / `失效→已修` / `失效但无害（保留兼容）` / `语义漂移→已修`。

### 2.1 布局骨架

| 锚点 | 对应功能 | 0.2.1-rc.2 证据 | 结论 |
| --- | --- | --- | --- |
| `[data-slot="root"]` + 首个子元素 = frame | `frameElement()`：⑤窄屏判宽、⑱furl、⑲会话列 | `dsh-client-ui-renderer/lib/client.js:1124`（SlotOutlet 输出 `"data-slot": slotKey`）、`:1243`（RootOutlet `"data-slot": "root"`）；活体：`[data-slot=root] > div.pI_x6G_frame` | 可用 |
| `[data-slot="sidebar"]` | 手势 CSS、点击边栏外收起、展开动画 | `dsh-client-ui-layout/lib/client.js`（`renderSlot("sidebar")`）、`dsh-client-ui-sidebar/lib/client.js`（`register({name:"sidebar"})`） | 可用 |
| `[data-side="sidebar"]` | 点击外收起的排除名单 | 0.2.1 仅拖拽手柄用 `data-side`（`dsh-client-ui-layout/lib/client.js:198`、`dsh-client-ui-conversation/lib/client.js:17469`，都是拖拽手柄 DragHandle），sidebar 本体不再是该属性 | 失效但无害：排除名单里的冗余项，`[data-slot="sidebar"]` 已覆盖同一语义；保留以兼容 ≤0.1.6（该处多一条死分支不影响正确性） |
| `[data-sidebar-collapsed]`（frame） | ⑤会话切换收起、⑱furl 判据 | `dsh-client-ui-layout/lib/client.js:323` | 可用 |
| `[data-rightbar-fullscreen]` | ⑲（只出现在注释里，不参与选择器） | `dsh-client-ui-layout/lib/client.js:325` | 可用（未使用） |
| `[data-shell-overlay]` | 点击外收起的排除名单、手势排除面 | `dsh-client-ui-layout/lib/client.js:351` | 可用 |
| `[class*="_centerCol"]` | ⑲会话列让位 padding | `dsh-client-ui-layout/lib/client.js:84`（class map `pI_x6G_centerCol`） | 可用 |
| `[data-sidebar-right-panel="fullscreen"]` + `[data-sidebar-right-open]` | ⑲面板半屏分栏、`body:has()` 开合判定 | `dsh-client-ui-sidebar-right/lib/client.js:1415`（`panel:"fullscreen"/"push"`）、`:1416`（open）；判据 `autoFullscreen = viewportWidth < 768`（`:1461`） | 可用。几何实现变了：官方从 `position:fixed; inset:0 + 内联 width:100%`（0.1.6）改为 `position:absolute; top/bottom/right:0 + 内联 width:100vw`——本插件的 `left:50% !important; width:auto !important` 在两种形态下都解得"右半屏"，无需改选择器（已同步更新注释） |

### 2.2 会话 header 一族（**本次最重的结构位移**）

> 官方 0.1.7 起把 `<header>` 从槽位宿主**内部**挪到**外部**：
> ≤0.1.6 `<div data-slot="conversation.session.header"><header>…`（0.1.5-rc.3 实测 ConversationSessionHeader 自己渲染 `<header>`）；
> ≥0.1.7 `<header class="…_header"><div.headerLeading><div data-slot="conversation.session.header"><div.titleRow>…`
> （0.2.1 证据：`dsh-client-ui-conversation/lib/client.js:17901` `jsxs("header")` + `:17908` `renderSlot("conversation.session.header")` 落在 header 之内）。
> 活体实测：`document.querySelector('[data-slot="conversation.session.header"] > header') === null`，
> `host.parentElement` = `header.wSkVaW_header`。

| 锚点 | 对应功能 | 0.2.1-rc.2 证据 | 结论 |
| --- | --- | --- | --- |
| `[data-slot="conversation.session.header"]`（宿主本身） | 兜底定位、面包屑、actions/utilities 命名空间 | `dsh-client-ui-conversation/lib/client.js:19841`（声明）、`:17908`（renderSlot） | 可用 |
| `…["conversation.session.header"] > header` | ⑨IME 隐藏 header、⑪header 横滑、⑱furl margin-left、JS `headerElement()/titleRow()/syncFabHeight()/menuGuard` | 0.2.1 与 0.1.7-rc.2 均 **0 命中**（选择器方向反了） | **失效→已修**：新增对偶形 `header:has(> [data-slot="conversation.session.header"])`，CSS 里两形各生成一条独立规则（`src/client.ts:227-241` 的 `HEADER_SEL_*`/`bothForms()`），JS 用 `headerElement()`（`src/client.ts:958`）两形都认 |
| `…["conversation.session.header"] > header > div:first-child`（titleRow） | ⑪手机端 header 横向滑动、菜单开合防裁剪 | titleRow 位置随 header 位移：≥0.1.7 是**槽位宿主**的首个子元素（活体：`div.wSkVaW_titleRow`，`hostPath=…> header > div[data-slot] > div.titleRow`） | **失效→已修**：`TITLE_ROW_OLD/TITLE_ROW_NEW` + `bothForms()`；活体验证 390×844 下 `overflow-x:auto` 已生效 |
| `nav button:disabled`（当前会话名） | ⑨IME 悬浮 Session name 条 | 当前段自 0.1.7 起是 `span.crumb.crumbCurrent`，不再是 disabled 按钮（`dsh-client-ui-conversation/lib/client.js:18002`，空祖先兜底 `span.crumbCurrent` 见 `:18028`） | **失效→已修**：`sessionName()`（`src/client.ts:971`）改为 `[class*="_crumbCurrent"], nav button:disabled` 双形 + 最后一段兜底 |
| `[data-slot="conversation.session.header.actions"]` | ⑦⑧⑩手机端按钮缩窄 | `dsh-client-ui-conversation/lib/client.js:19855` | 可用 |
| `…header.actions span[title]` | ⑧模式选择缩窄 | `dsh-client-ui-agent-preset/lib/client.js:1001`（`AgentPresetLabel`）、`:1015`（`span.label` 带 `title`） | 可用 |
| `…header.actions button[aria-expanded]:not([aria-haspopup])` | ⑩后台任务按钮 | `dsh-client-ui-jobs/lib/client.js:461`（`button.trigger` + `aria-expanded`，无 `aria-haspopup`；子级 `span.count` / svg / StateDot） | 可用 |
| `…header.actions button[aria-haspopup="tree"]` | ⑩子代理目录按钮 | `dsh-client-ui-subagent/lib/client.js:541` | 可用 |
| `svg[data-state]`（StateDot） | ⑩⑫状态小图标判据 | `dsh-client-ui-primitives/lib/index.js:3074`（StateDot）、`:3079`（`"data-state": "ongoing"`） | 可用 |
| `[data-slot="conversation.session.header.utilities"]` | ⑦Session log 按钮缩窄 | `dsh-client-ui-conversation/lib/client.js`（slot 声明）、`dsh-session-log-export/lib/client.js`（注册 `id:"session-log-download"`） | 可用/空转：0.2.1 官方该按钮**本身就是纯图标**（`IconEllipsisOutlineRegular` 直接作 children，不套 span），`button span{display:none}` 规则命中不到东西也不误伤 |
| `html[ime] … > header { display:none }` | ⑨IME 时隐藏原生 header | 同 header 一族 | **失效→已修**（随 §2.2 第一条一起修） |

### 2.3 composer（输入区）

| 锚点 | 对应功能 | 0.2.1-rc.2 证据 | 结论 |
| --- | --- | --- | --- |
| `[data-composer-card]` | ①②⑬折叠、pointerdown 展开、photo probe、手势排除 | `dsh-client-ui-conversation/lib/client.js:18990` | 可用 |
| `[data-input-scroll]` | ①⑬折叠高度（`max-height` 契约） | `dsh-client-ui-conversation/lib/client.js:18145`（DraftEditor 的 `css.scroll`，官方 CSS `max-height: var(--dsh-composer-text-max-height)` 仍在） | 可用 |
| `[data-composer-input]` | ①④⑳输入区判定（回车拦截/enterkeyhint/聚焦） | `dsh-client-ui-conversation/lib/client.js:18102` | 可用 |
| `div[class*="_row"]` / `div[class*="_trailing"]` | ②按钮行单行排布 | `dsh-client-ui-conversation/lib/client.js` InputBar class map（`uV2eYG_row` / `uV2eYG_trailing`，`flex-wrap:wrap` / `flex:none` 官方值仍在） | 可用 |
| `[data-slot="conversation.input.model"]` | ②极窄隐藏 effort 徽标 | `dsh-client-ui-conversation/lib/client.js:19908` | 可用 |
| `…button[aria-haspopup="menu"] > span:not(:first-child)` | ②同上 | `dsh-client-ui-model-selection/lib/client.js:1496`（trigger children 顺序 = `[svg 图标, span.triggerLabel, span.triggerEffort, svg 箭头]`，`triggerEffort` 见 `:1520`） | **语义漂移→已修**：`:first-child` 判的是"首个孩子"而首个孩子是 svg → 模型名也被藏掉；改为 `:not(:first-of-type)`（`src/client.ts:303`），0.1.5-rc.3/0.1.7-rc.2/0.2.1-rc.2 的 children 顺序实测一致，改动对三版都是"只藏 effort" |
| `[data-composer-card] input[type="file"]`（photo-picker 探测） | 手机发图按钮是否与官方重复 | `dsh-client-ui-conversation/lib/client.js:19061`（InputBar 内 `input type="file" multiple hidden`，位于 `[data-composer-card]` 子树内） | 可用：探测命中 → 插件不重复挂 📷（与设计一致） |
| `document` 上的 `drop` 监听（合成 drop 注入附件） | 手机发图 | `dsh-client-ui-attachment/lib/client.js:581`（`document.addEventListener("drop", onDrop)`） | 可用 |

### 2.4 消息区（功能⑰）

| 锚点 | 对应功能 | 0.2.1-rc.2 证据 | 结论 |
| --- | --- | --- | --- |
| `[data-time-hover-root] > [class*='_actions']` | ⑰消息操作行横滑 | **0.2.1-rc.2 全 @deepseek-ai 包 0 命中**；对照 0.1.2-rc.1 / 0.1.3-alpha.2 / 0.1.5-rc.3 / 0.1.6-alpha.2 / 0.1.7-rc.2 也**全部 0 命中**（该属性最晚在 0.1.2 就没了，代码注释里的"rc.6/rc.2 实测"指的是 0.1.0-rc.x） | **失效→已修** |
| `div[class*='_userRow'] > [class*='_actions']`（新增） | ⑰用户行 | `dsh-client-ui-chat/lib/client.js:5414`（`className: MessageItem_module_css_default.userRow`）+ class map `:4312`；`actions?.(text)` 是 userRow 的**直接子级**（0.2.1 `dsh-client-ui-chat/lib/client.js:5422`；0.1.5-rc.3 同构） | 可用（0.1.2-rc.1 → 0.2.1-rc.2 全版本有 `_userRow`） |
| `[data-turn-tail] > [class*='_actions']`（新增） | ⑰AI 轮尾 | `dsh-client-ui-chat/lib/client.js:6984/6991`（`"data-turn-tail": data.turn`，actions 为直接子级）、`:6992` 同元素带 `data-actions-reveal`；`_actions` 类 `:5151`/`:5207`（`xzv4MW_actions`，0.1.2 → 0.2.1 哈希未变） | 可用 |
| `[data-chat-flow-kind]`（未直接用，结构判据参考） | ⑰上下文 | `dsh-client-ui-chat/lib/client.js:3810` | 可用 |
| `.md-table-wide` | ⑰.1触屏宽表常开横滑 | `dsh-client-ui-chat/lib/client.js:6220`、`dsh-client-ui-primitives/lib/index.js:11620`（类名输出） | 可用 |

> 直接子级限定很关键：0.2.1 里设置弹窗内容区也有一个 `[hash]_actions`（`div.jLrgrW_body > div.t1T8VW_actions`，活体实测到），
> 三条选择器都要求"动作行是 userRow / turn-tail 的直接子级"，不会误伤它。

### 2.5 提醒卡片 / 设置面板 / 其它

| 锚点 | 对应功能 | 0.2.1-rc.2 证据 | 结论 |
| --- | --- | --- | --- |
| `[data-approval-key]` | ⑫官方面板接管判定 | `dsh-client-ui-approval/lib/client.js:83` | 可用 |
| `[data-question-key]` / `[data-plan-review-key]` | ⑫同上 | `dsh-client-ui-user-questions/lib/client.js:1008` / `:544` | 可用 |
| `div[role="dialog"] > nav`（设置面板） | ⑯手机端设置页改造 | `dsh-client-ui-settings-general/lib/client.js:275`（SettingsPanel）、`:295`（`nav` 是 panel 的直接子级；`nav > div.navList > button > span.navLabel` 结构仍在，CSS `> nav > div > button > span` 继续命中） | 可用；另加更稳的 `[data-shortcut-modal="settings"]`（`:290`，0.1.7-rc.2 起就有）作主锚点 |
| `[role="menu|menuitem|listbox|option|dialog"]` | 排除名单（点外收起 / 手势） | `dsh-client-ui-primitives/lib/index.js`（Menu/MenuSurface/Modal） | 可用 |
| `[data-plugin]`（样式表认领保护） | 防 0.1.6 模块加载器"认领无主 style"连坐删除 | 0.2.1 各客户端包注入 CSS 时都写 `tag.dataset.plugin = "<包名>"`（如 `dsh-client-ui-chat/lib/client.js:2679` 附近）；本插件三张样式表都自带 `data-plugin="meow-smooth"` | 可用（约定未变） |
| 无锚点（纯浏览器 API） | ③缩放锁、⑭橡皮筋、㉑返回手势（`back-guard.ts`）、通知（`notify-client.ts` 的 `Notification`/SW） | 不依赖 dsh DOM | 不适用 |

---

## 3. 客户端服务 / slot / standard props 审计表

| 服务 / 注入点 | 对应功能 | 0.2.1-rc.2 证据 | 结论 |
| --- | --- | --- | --- |
| `inject = ['slots','layout','sessions','conversation']` | apply 前置检查 | `sessions`/`conversation` 客户端服务在 0.2.1 均存在（`dsh-api-session-controller/lib/client.js`、`dsh-client-ui-conversation/lib/client.js`） | 可用 |
| `ctx.slots.inject(key, factory)` | 全部槽位注入 | `dsh-client-ui-renderer/lib/client.js:1368` | 可用 |
| `slots.register({name,id,order,inject}, Comp)` | 同上 | `dsh-client-ui-slots/lib/index.js:163-220`（`id`/`order`/`inject`/`priority` 全保留；list 槽位仍强制 `id`） | 可用 |
| `slots.inject('conversation.composer.dock')` | ⑤会话切换收起 + ⑫pending 汇报 | `dsh-client-ui-conversation/lib/client.js:19916`（`kind:"list", scope:"session"`） | 可用 |
| `slots.inject('conversation.input.right')` ×2（run-send order 999 / photo order 998） | 运行时发送按钮、手机发图 | `dsh-client-ui-conversation/lib/client.js:19904` | 可用 |
| standard props：`sessionId` / `useSessions` / `useSession` / `useInput` | FoldDock（dock 槽）、RunSendButton（input.right 槽） | `dsh-client-ui-renderer/lib/client.js:726`（标准 kit 合成）；`dsh-cordis-client-runner/lib/client.js` 的 slot 目录里 `conversation.input.right` / `conversation.composer.dock` 的 `standardProps` 均含 `useSessions`/`useSession`/`useInput`/`sessionId` | 可用 |
| `ctx.layout.toggleSidebar()` | ⑤⑱ | `dsh-client-ui-layout/lib/client.js`（LayoutController 面） | 可用 |
| `ctx.sessions.scope(sessionId)` | run-send inject 取行内会话 ctx | `dsh-api-session-controller/lib/client.js:4013` | 可用 |
| `actx.get('conversation')` | run-send inject | 官方同款：`dsh-client-ui-conversation/lib/client.js:17211-17218`（queue dock） | 可用 |
| `conversation.input.for(actx).submit(mode)` | 运行时发送按钮 | `dsh-client-ui-conversation/lib/client.js:15739`（`for`）、`:15164`（`submit(mode, source)`）；`for()` 在"会话 scope 已不在场"时**会抛错**（`:15741`） | 可用 + 已加护栏（try/catch，见 §5.7） |
| `ctx.sessions.refresh()` | ⑫横幅跳转遇 unknown session 先刷新 | `dsh-api-session-controller/lib/client.js:3906` | 可用 |
| `ctx.sessions.open(sessionId)` | ⑫横幅/系统通知跳转会话 | **0.2.1 已无该方法**：`ClientSessions`（`dsh-api-session-controller/lib/client.js:3789`）方法表 = constructor/retain/retainInfo/subagentAddress/refreshProjections/refresh/search/handle*/scope/retainAgentScope/scopeOf/sessionOf/binding/retainScope/retentionSnapshot/publishRetention/retireScope/materializeScope/projectList/startScopeDrop/connected；对照 0.1.5-rc.3 **有** `open`，0.1.6-alpha.2 起**没有** | **失效→已修**：改用官方自己走的路 `ctx.get('uiWorkspace').openSession(id)`（`dsh-client-ui-workspace/lib/client.js:1470`；官方调用点 `dsh-client-ui-conversation/lib/client.js:19497`/`:19872`），`sessions.open` 保留为老版本兜底（`src/client.ts:2791-2796`） |
| `ctx.get('settingsScope')` | run-send 的 busyEnter 设置 | 0.2.1-rc.2 全 @deepseek-ai 包 **0 命中**（0.1.7 起移除） | 走既有软取降级路径：`ctx.get === undefined` 时 `useBusyEnter` 返回 `undefined`，组件按 `queue` 兜底，**不抛错**（实测 apply 完成、无 console error） |
| `navigator.serviceWorker.register('/plugins/meow-smooth/sw.js')` | 系统通知（PWA/SW 桥） | 客户端无 dsh 依赖；SW 路由属 host 侧（见 host 文档） | 不适用 |

---

## 4. 活体实测记录（17899 测试实例，headless chromium）

| 视口 | 实测项 | 结果 |
| --- | --- | --- |
| 1440×900 | `[data-slot=root] > div.pI_x6G_frame`；`[data-slot="conversation.session.header"] > header` | `false`（旧形确认失效） |
| 1440×900 | 槽位宿主父级 | `header.wSkVaW_header.wSkVaW_headerBlank`（新形确认） |
| 1440×900 | `titleRow` | `div.wSkVaW_titleRow` 是槽位宿主首个子元素 |
| 1440×900 | `data-time-hover-root` | 0 命中；页面唯一 `_actions` 是设置弹窗内容区的 `div.t1T8VW_actions`（不会被我方选择器误伤：非 userRow/turn-tail 直接子级） |
| 390×844 | 构建的新选择器 | `headerElement()` 命中 `header.wSkVaW_header`，`margin-left: 56px`（⑱ furl 让位）**已生效** |
| 390×844 | titleRow 横滑 | `div.wSkVaW_titleRow` `overflow-x: auto` **已生效**（修复前该规则挂在失效路径上） |
| 390×844 | 其它 | `meta viewport` 含 `maximum-scale=1, user-scalable=no`（③）、`body overscroll-behavior: none`（⑭）、gesture 样式表在（⑲）、`data-md-table-wide` 规则在（⑰.1）、apply stage = `suppressor-registered`，**console/pageerror/HTTP≥400 全为空** |
| 390×844 | FAB 高度 | `data-meow-h=40` 与 header 实高一致（修复前 `headerElement()` 恒 null → 该逻辑整段空转、FAB 永远停在 CSS 兜底高） |

> 消息操作行（⑰）的**活体**断言留给 verifier：测试实例当前 Home 没有带消息的会话，
> 静态证据两条链都齐（0.2.1-rc.2 的 `MessageItem.js` 与 `TurnTailNodeView.js` 渲染结构 + 0.1.5-rc.3 同构对照）。

---

## 5. 修复清单（改了什么、为什么跨版本安全）

| # | 文件:行 | 失效锚点 | 改法 | 跨版本安全性 |
| --- | --- | --- | --- | --- |
| 5.1 | `src/client.ts:222-241` | `…["conversation.session.header"] > header`（header 位移） | 新增 `HEADER_SEL_OLD/NEW`、`TITLE_ROW_OLD/NEW` 常量 + `bothForms()`：同一段 CSS 按两形各生成**一条独立规则**（`%H%`/`%T%` 占位） | 旧浏览器不支持 `:has` 时**只丢新形那条**，旧形规则照常；老 dsh 命中旧形、新 dsh 命中新形（这正是不能把两形写成逗号列表的原因：列表里出现不支持的选择器会让整条规则作废） |
| 5.2 | `src/client.ts:435-448` | `[data-time-hover-root] > [class*='_actions']`（⑰） | 追加 `[class*='_userRow'] > [class*='_actions']`、`[data-turn-tail] > [class*='_actions']`，三条并列共用同一段声明；旧形保留 | 三条选择器都是"直接子级 + 类尾缀"，0.1.2-rc.1 → 0.2.1-rc.2 全版本可用；老版本命中旧形，新版本命中新形，互不冲突 |
| 5.3 | `src/client.ts:958`（新增）、`:1690`、`:2659` | JS 侧 4 处 header 定位（`titleRow()`、`syncFabHeight()`、`menuGuard`、`syncHeaderMenu`） | 新增 `headerElement()`（先认宿主父级是 `<header>`，再认宿主内 `:scope > header`）；`titleRow()` 按"首个子元素是不是 `<header>`"分形；`menuGuard` 改为 `headerElement() + contains(target)` | 两形自适应；两形都找不到 → `null` → 原逻辑一律 no-op |
| 5.4 | `src/client.ts:971` | `nav button:disabled`（会话名） | `sessionName()` 改为 `[class*="_crumbCurrent"], nav button:disabled` 双形，再兜底"最后一个面包屑段文本" | `_crumbCurrent` 是 CSS Modules local 名尾缀（哈希前缀随版本变、尾缀稳定，与⑰/⑲同一锚法）；≤0.1.6 命中 disabled 按钮形 |
| 5.5 | `src/client.ts:303` | `span:not(:first-child)`（②） | 改 `span:not(:first-of-type)` | 三版 children 顺序实测一致，语义从"首个孩子之外的 span"变成"首个 span 之外的 span"，即文档原意；任何版本都只会藏得更少，不会误藏模型名 |
| 5.6 | `src/client.ts:1708` | `header.firstElementChild === null`（⑱空壳判定） | 改 `header.querySelector('nav, button') === null` | ≤0.1.5 空壳 header 无子元素 → 旧判据等价；≥0.1.6 header 恒有 `headerLeading`+槽位宿主 → 旧判据恒 false（会误判"已隐藏"而撤掉新会话页唯一的侧边栏入口）。新判据在两代都表达"没有真实内容" |
| 5.7 | `src/client.ts:2791-2796`；`:2846` | `ctx.sessions.open`（⑫跳转） | 优先 `ctx.get('uiWorkspace').openSession`，退化 `sessions.open`，都没有 → 回调 undefined + 告警；`conversation.input.for(actx).submit()` 包 try/catch | 0.1.5 只有 `sessions.open`（走兜底）；0.1.6+ 只有 `uiWorkspace.openSession`（走主路）。全链无抛错 |
| 5.8 | `src/client.ts:2413` | （历史 `tsc` 报错，非锚点） | `origRemoveChild.call(this, child) as T`，附注释说明 `lib.dom` 泛型被 `Function.call` 擦除 | 运行期语义不变（原样返回入参）；`tsc -p tsconfig.json` 现在 **0 错误**（含历史错误一起清零，无新增） |
| 5.9 | `src/client.ts:1460-1469` | `data-meow-fold-mode-expanded` 属性名笔误（⑧展开态点别处收起无效） | `dataset.meowFoldModeExpanded` → `dataset.meowSmoothModeExpanded`，与 `onModeLabelDismiss` 的查询对齐 | 纯内部属性；老版本行为从"永不收起"变为"正常收起"（修复预期行为） |
| 5.10 | `src/settings-mobile.ts:34/253/259` | `data-meow-settings-css` 与 `data-meow-smooth-settings-css` 不一致（⑯样式表热替换删不掉；verify 探针也查不到） | 统一用 `STYLE_ATTR` 常量 `setAttribute` | 纯内部标记；`verify/cdp.mjs:455` 的 dump 与插件终于对得上 |
| 5.11 | `src/settings-mobile.ts:144` | `div[role="dialog"] > nav`（⑯面板定位） | 增加更稳的主锚点 `[data-shortcut-modal="settings"]`（校验 `role=dialog`），旧形保留为兜底 | `data-shortcut-modal="settings"` 在 0.1.7-rc.2 与 0.2.1-rc.2 都在；≤0.1.6 落回旧形 |
| 5.12 | `src/client.ts:656-666`（注释） | ⑲几何假设过期 | 注释更新为 0.2.1 实测几何（`absolute; right:0; width:100vw`），选择器不变 | 代码零改动，仅文档与注释 |

**未改动但已确认的模块**：`src/notify-client.ts`（只用浏览器 API + host 路由）、`src/back-guard.ts`（history/popstate）、
`src/sidebar-gesture.ts`（`[data-slot="sidebar"]` / `[data-composer-card]` / `[data-shell-overlay]` / `data-sidebar-collapsed` / role 排除面逐条可用）、
`src/photo-picker.tsx`（`[data-composer-card]` + 文档级 drop 均可用）、`src/run-send.tsx`（standard props 与槽位契约未变；`submitMode` 护栏在 client.ts 侧）。

---

## 6. 保留项 / 未修项与理由

| 项 | 状态 | 理由 |
| --- | --- | --- |
| `[data-side="sidebar"]`（`src/client.ts:1778`） | 保留（死分支） | 排除名单里的冗余项，不影响正确性；删掉反而丢 ≤0.1.6 兼容 |
| `button[aria-haspopup="tree"] > span:not(:first-child)`（子代理按钮） | 保留原语义 | 0.1.7-rc.2 与 0.2.1-rc.2 的 children 结构逐字一致（`runningCount > 0 && <span.activitySlot>` 条件渲染），行为与老版本相同；改成 `:first-of-type` 会连"空闲态计数文字"一起露出来，属另一处独立观感问题，不在"适配 0.2.1"范围 |
| `conversation.input.for()` 的"未保留 scope 即抛错" | 已加护栏，未改语义 | 官方契约如此（`dsh-client-ui-conversation/lib/client.js:15741`）；插件只保证点一下不炸页面 |
| 消息操作行（⑰）的活体断言 | 待 verifier | 测试实例当前无带消息会话；静态双版本证据已闭环（见 §2.4） |
| `settingsScope` 缺失下的 busyEnter | 已确认优雅降级 | 0.2.1 该服务确已移除；软取返回 `undefined`，按钮退化为按 `queue` 提交，无 console 报错 |

---

## 7. 复现与验证

```bash
# 构建（必须重建，verifier 的浏览器验证看的是 lib/client.js）
cd /root/ws/meow-smooth && node build.mjs

# 类型
node_modules/.bin/tsc -p tsconfig.json     # 0 错误

# 自查锚点（活体；测试实例 17899，勿动 17890）
node verify/cdp.mjs --url http://127.0.0.1:17899 --viewport mobile  --wait 9000 --dump-dom
node verify/cdp.mjs --url http://127.0.0.1:17899 --viewport desktop --wait 8000 \
  --selectors 'header:has(> [data-slot="conversation.session.header"]),[class*="_userRow"] > [class*="_actions"],[data-turn-tail] > [class*="_actions"]'
```

关键断言（三视口/两形态都应成立）：
1. `document.querySelector('header:has(> [data-slot="conversation.session.header"])') !== null`；
2. 手机视口下该 header 的 `margin-left` 在 furl 态 = `56px`，titleRow `overflow-x = auto`；
3. 有消息的会话里，`[class*='_userRow'] > [class*='_actions']` 与 `[data-turn-tail] > [class*='_actions']` 命中 ≥1 且 `overflow-x = auto`；
4. `style[data-meow-smooth-settings-css]`、`style[data-meow-smooth-gesture-css]`、`style[data-meow-fold-css]` 三张样式表都在；
5. console / pageerror / HTTP≥400 全空。
---

## 8. 回归修复：BEHAV-5「窄屏切会话自动收起」（2026-10-26）

### 8.1 现象与严格 A/B（同一实例、同一 host 进程，唯一变量 = client bundle）

| 轮次 | 构建 | 流程 | 观测 |
| --- | --- | --- | --- |
| 16:07（verifier） | 上游原样 `d3a414f0ae89` | 展开侧栏 → 点上游 "New Session" | `collapsed=true, furl=true` ✅ |
| 16:12（verifier） | 含本次 7 处修复 `7eeeced156fd` | 同上 | `collapsed=false, furl=null` ❌ 6s 内不收 |
| 10-26 复核 A | **`git stash` 掉本次全部 client 改动**（`git stash push -- src/client.ts src/settings-mobile.ts`）→ `node build.mjs` | 同上 | **❌ 同样 FAIL**：`before{true,true} → afterFab{false,null} → afterSwitch{false,null}`；console 只有上游代码自身的 `[meow-smooth] sessions service unavailable; banner jump disabled`，无 pageerror、无未捕获异常 |
| 10-26 复核 B | 本次构建（stash pop 后重建） | 同上 | **❌ 同样 FAIL，且 console 完全为空** |

**结论：BEHAV-5 的失败不是本次 7 处修改引入的**（罪魁 = 0/7），而是测试实例状态漂移 + 插件一条**既有的槽位盲区**。16:07 与 16:12 的 A/B 不成立：两次之间实例状态已变。

### 8.2 根因（活体 + 静态双证）

活体（390×844，17899，headless chromium；`[data-meow-smooth-fab]` 点击前后各 dump 一次）：

```
convPhase = "hero"（conversation 根节点 data-phase）
inputBarHero = true（InputBar 带 [hash]_hero）
[data-slot="conversation.composer.dock"]   → false   ← FoldDock 根本没挂载
[data-slot="conversation.input.right"]     → true
[data-composer-card]                       → true
console = []   pageErrors = []
```

静态（0.2.1-rc.2 官方产物）：

- `dsh-client-ui-conversation/lib/client.js:19164`：**只有** `variant === "composer"` 才 `renderSlot("conversation.composer.dock", {})`；
- 同文件 `:17821`：`variant: hero ? "hero" : "composer"`；
- 同文件 `:17545`：`hero = sessionId === undefined || (shellPhase === "blank" && (openState === "open" || summaryBlank === true))`。

即：**空会话（hero 态，含"新会话页"）整条 `conversation.composer.dock` 槽位不渲染** → 插件的隐形 FoldDock 条目从未挂载 → `onSessionSwitch → maybeCollapseSidebar()` 一次都跑不到（与页面上是否有异常无关）。

为什么"以前能过、现在必挂"：测试 home 现有 10 个会话**全是空会话**（`session.v4.jsonl.zstd` 均 ~336B）；而 BEHAV-5 自身每跑一次都会点 "New Session"、把一个新的空会话留下选中。于是第一轮 PASS（当时选中的是非空会话，dock 挂载）之后，实例永久停在 hero 态 → 任何构建都必然 FAIL（自锁陷阱）。这也解释了为什么 `waitedMs=6028`（等满 6s 超时）而不是"收了又展开"。

### 8.3 修法（本次第 8 处改动，`src/client.ts:2810-2838`（dock 在 `:2826`、hero 兜底在 `:2832`））

同一隐形组件 `FoldDock` **两处挂载**：

1. `conversation.composer.dock`（order 90）——composer 态原路径，保持不动；
2. `conversation.input.right`（order 997）——**hero 态兜底**：该槽位的渲染条件只有 `input !== undefined && sessionId !== undefined`（`dsh-client-ui-conversation/lib/client.js:19080`），空会话页照常挂载（活体 `inputRightSlot=true`）。

幂等性论证：`maybeCollapseSidebar` 第二次调用时 `collapsed && furl` 已成立 → 立即早退；`reportLocalPending` 覆盖写同一份模块状态；撤焦 effect 第二次 `activeElement` 已不是输入区 → no-op。两个槽位在 0.1.3 → 0.2.1 都存在，老版本多挂一处也只是一次幂等调用（渲染 null，不动 UI）。

### 8.4 复验

```
node verify/run-all.mjs --only BEHAV-5 --target 17899=/tmp/meowtest-boot.log
  → ✅ PASS  BEHAV-5（切换后 221ms 内 collapsed=true, furl=true；被测 rev=356e4fdc0733）
node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log
  → 汇总：PASS=23 FAIL=0 N/A=1（N/A = 无 pending 时的 ANCHOR-3，属预期）
```

### 8.5 给验证口径的建议

- BEHAV-5 的前提是"点击时插件观察者已挂载"。插件现在 hero 态也挂载，断言可继续用"展开 → 点 New Session"路径；
- 若要更严格地区分"插件盲区"与"实例状态"，可在断言前先给当前会话发一条消息（或显式选中非空会话），再执行切换；这样即使将来官方又收紧某槽位的渲染条件，断言仍能测到插件行为而不是被测环境；
- 排查提示：`[data-slot="conversation.composer.dock"]` 是否存在（以及 conversation 根节点的 `data-phase` 是否 `hero`）应作为此类"会话级 hook 不触发"问题的第一诊断量。
