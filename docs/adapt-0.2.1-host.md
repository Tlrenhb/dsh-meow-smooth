# meow-smooth host 侧适配 dsh 0.2.1-rc.2 核对报告

- 日期：2026-10-25
- 范围：host（Node）半边 —— `src/index.ts`、`src/notify-host.ts`、`src/auth-gate.ts`、`src/compress-proxy.ts`
- 参照物（**只读**，0.2.1-rc.2 真实产物）：
  - `/opt/dsh-local/profiles/web/node_modules/@deepseek-ai/*/lib/types/*.d.ts`（宿主契约）
  - `/opt/dsh-local/profiles/web/node_modules/@deepseek-ai/*/lib/*.js`（实现）
  - 运行时实例：`DSH_HOME=/tmp/dsh-test-home dsh --profile meowtest --port 17899`
- 被测版本：`@deepseek-ai/dsh` = `0.2.1-rc.2`（`node_modules/@deepseek-ai/dsh/package.json`）
- 结论：**6 项契约全部仍然成立，无一条"硬不兼容"**；发现 1 处新增字段（可利用）、1 处新增约束（需防御）、1 处语义细化（需补扫），均已修复。
- 构建：`node build.mjs` 通过（`lib/index.js` 44.0kb / `lib/client.js` 112.3kb）。

> 约定：插件刻意**不 import 任何宿主包**（避免 esbuild 全量打包出第二份 cordis 实例导致双实例冲突），全部经 `ctx` 属性访问 / `ctx.get` 软取 + 优雅降级，因此下文所有类型断言都写成"结构子集"。

---

## 0. 总览：逐条判定

| # | 核对项 | 判定 | 是否需改代码 |
|---|---|---|---|
| a | `inject = ['sessions','webServer','connection']` 服务名 | ✅ 三个全部未变 | 否（仅补注释） |
| b | `webServer.register({kind:'exact',path,handler})` 签名 / dispose | ✅ 签名与 disposer 未变；⚠️ **新增"重复 (kind,path) 抛错"**约束 | 是（注册方式对齐官方 + 永不抛错） |
| c | 事件名与载荷（`session/event`、`approval/request`、6 个审计事件） | ✅ 名称与字段未变；➕ `approval/asked` **新增 `reason` 字段** | 是（reason 双源） |
| d | `sessions.list()` / `get(id)` / `sessionEventsOf()` | ✅ 仍同步可用；⚠️ 语义明确为 **live-only** | 是（补 `session/created` 重扫） |
| e | Web Push 链路（`.meow-smooth` 存储 / webhook / x-meow-focus） | ✅ 不受影响 | 否 |
| f | 压缩代理官方 gzip 探测 / 默认关闭 | ✅ 探测仍正确；✅ 默认关闭仍是安全默认 | 否（仅补注释 + 端口取权威值） |

---

## a. `inject = ['sessions','webServer','connection']` 服务名核对

**结论：三个服务名在 0.2.1-rc.2 全部未变，声明方式与官方一致，无需改动。**

| 服务 | 类型面证据（0.2.1-rc.2 产物） | 运行时注册证据 |
|---|---|---|
| `sessions` | `dsh-session/lib/types/index.d.ts:28` → `sessions: SessionStore` | `dsh-session/lib/index.js:1739` → `super(ctx, "sessions")` |
| `webServer` | `dsh-host-webserver/lib/types/index.d.ts:18` → `webServer: WebServer` | `dsh-host-webserver/lib/index.js:286` → `super(ctx, "webServer")` |
| `connection` | `dsh-client-connection/lib/types/rpc-host.d.ts:10` → `connection: HostConnectionHandle` | `dsh-client-connection/lib/index.js:710` → `super(ctx, "connection")` |

旁证（官方插件同款声明方式）：

- `dsh-host-open-in-app/lib/index.js:1160-1163` → `const inject = ["webServer", "connection", "subprocess"]`
- `dsh-client-connection` 在 web 组合里必然装配：`dsh-web-app/cordis.patch.yml` 的 webserver row + 连接层；`dsh-base/cordis.patch.yml:41` 装配 `@deepseek-ai/dsh-session`。

**运行时确认**：`GET /plugins/meow-smooth/pending` 无 cookie 返回 **401**（而非 404/503）——404 说明 `webServer` 未取到（路由没注册），503 说明 `connection` 未取到（鉴权能力缺失）；401 同时证明**两个服务都成功取到且鉴权闸生效**。

**修复说明**：无功能改动，仅在 `src/index.ts` 的 `inject` 注释里补上上述 file:line 核对结论，供后续版本升级时对照。

---

## b. `webServer.register()` 签名与 dispose 语义

**类型面证据**（`dsh-host-webserver/lib/types/index.d.ts`）：

```ts
export type WebRouteKind = 'exact' | 'prefix';                    // :32
export interface WebRoute {                                        // :34-40
  kind: WebRouteKind;
  path: string;            // Absolute pathname, no trailing slash.
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;  // 自持响应生命周期
}
register(route: WebRoute): () => void;                             // :174  ← 返回的正是 disposer
registerUpgrade(route: WebUpgradeRoute): () => void;               // :181
registerFallback(handler: WebRoute['handler']): () => void;        // :190
tapIndex(transform: (html: string) => string): () => void;         // :198
```

**逐条判定**：

1. **签名未变**：`{kind, path, handler}` 与插件使用的形状完全一致；插件只用 `kind:'exact'`，`path` 均无尾斜杠，合规。
2. **dispose 语义未变**：`register()` 直接返回移除该路由的 disposer（`:172` "the disposer removing the route"）。
3. ⚠️ **新增约束（0.2.1 起明确写入契约）**：`:169-170` "Duplicate (kind, path) **throws** — route patterns are a composition-level contract, so a collision is a misconfiguration."
4. **路由前缀 `/plugins/meow-smooth/...` 仍被放行**：运行时无 cookie 返回 401（若前缀被本体占用/拦截会是 404 或其它），证明精确路由命中且 handler 被调用。
5. **`tapIndex` 仍受支持**：`:191-198` 明确"新增的结构化 `webserver/index-inject` 表格是并行通道，**Anything not expressible as a row stays on `tapIndex`**"——插件继续用 `tapIndex` 注入 PWA link 是官方认可的路径。

**官方 0.2.1 的注册写法**（`dsh-host-open-in-app/lib/index.js:1271`）：

```js
ctx.effect(() => ctx.webServer.register({
  kind: "exact",
  path: OPEN_IN_APP_APPS_PATH,
  handler: async (req, res) => { if (rejected(req, res)) return; … },
}), `open-in-app: GET ${OPEN_IN_APP_APPS_PATH}`);
```

**修复说明**（`src/index.ts`、`src/notify-host.ts`）：

- 原 `src/index.ts` 在 `ctx.effect` **之外**先 `register()`、再把返回值塞进 effect。功能上能跑，但一旦出现"旧 fiber 路由未释放 / 同名重复装配"，直注册的 `throw` 会把整个插件装配打挂。现改为**与官方同款**：`ctx.effect(() => registerPendingRoute(), 'meow-smooth: pending route')`，注册与释放同一 effect 全生命周期。
- 新增 `registerPendingRoute()` / `registerRoute()` / `tap()` 三个包装：`try { … } catch { console.warn(…); return () => {} }`。cordis 的 `SyncEffect` **不接受 `undefined`**（`@deepseek-ai/cordis/lib/types/fiber.d.ts:50` 定义 `Disposable | Iterable<Disposable>`；`:151` "TypeError if execute returns an invalid shape"），所以失败分支返回**空 disposer**，保证路由撞车只降级为"该路由不可用 + 一条告警"，绝不影响宿主装配与其余能力。
- 保留 `ctx.effect` 缺失时的旧 cordis 直注册分支（跨版本安全）。

**运行时回归**（重启后逐条 curl，全部保留）：

| 路由 | 无 cookie | 带 cookie |
|---|---|---|
| `/plugins/meow-smooth/pending` | 401 | 200 JSON |
| `/manifest.json` / `icon-180.png` / `icon-512.png` / `sw.js` | 200（静态资源按设计开放） | 200 |
| `/push-config` | 401 | 200 `{"enabled":true,"publicKey":…}` |
| `/diag` | 401 | 200 `{"diag":[…]}` |

---

## c. 事件名与载荷

**类型面证据与逐条判定**（全部以 0.2.1-rc.2 产物为准）：

### c.1 监听入口

| 插件用法 | 0.2.1 契约 | 判定 |
|---|---|---|
| `ctx.on('session/event', (session, event) => …)` | `dsh-session/lib/types/index.d.ts:61` `'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void` | ✅ 名称/参数未变 |
| `ctx.on('approval/request', (req, next) => …)` | `dsh-user-approval/lib/types/types.d.ts:81` `'approval/request'(this: Scoped<Agent>, req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>` `@mode waterfall` | ✅ 名称/参数未变 |

**事件信封未变**：`SessionEvent = { type; seq; time; data; ignorable? }`（`dsh-session/lib/types/types.d.ts:490-513`）——插件通篇使用的 `event.type` + `event.data.<field>` 取值方式**继续成立**。

**作用域过滤不影响根级插件监听器**：`approval/request` 由 agent scope 派发（`dsh-user-approval/lib/index.js:176` `this.ctx.waterfall(scopeTarget(req.agent, req.agent), "approval/request", …)`），而 `dsh-scope/lib/types/index.d.ts:85-97` 明确："admits untagged listeners globally, and admits tagged listeners for a matching key or **any of its ancestors** … a listener owned by an enclosing scope receives every descendant scope's events"。官方实例：`dsh-acp/lib/index.js:1158` 就在插件级 `ctx` 上 `ctx.on("approval/request", …)`。→ 插件的 reason 观察者仍能收到派发。

### c.2 审计事件字段

| 事件 | 0.2.1 契约（file:line） | 插件读取的字段 | 判定 |
|---|---|---|---|
| `approval/asked` | `dsh-user-approval/lib/types/types.d.ts:37-42` → `{ id; toolName; callId?; reason? }` | `id` / `toolName` / `callId` | ✅ 未变；➕ **`reason` 是新增字段** |
| `approval/decided` | `dsh-user-approval/lib/types/types.d.ts:48-51` → `{ id; outcome }` | `id` | ✅ 未变 |
| `tool/call` | `dsh-session/lib/types/types.d.ts:355-361` → `{ turn; step; callId; name; arguments }` | `callId` / `name` / `arguments` / `turn` | ✅ 未变 |
| `tool/result` | `dsh-session/lib/types/types.d.ts:375-389` → `{ turn; step; message; error?; meta? }`；`ToolResultMessage.source = { kind:'tool'; callId }`（`dsh-llm/lib/types/message.d.ts:22-25`） | `data.message.source.callId` | ✅ 未变 |
| `session/title` | 事件注册：`dsh-session-title/lib/types/index.d.ts:42`；载荷 `SessionTitleEventData { title; messageSeqs; source }`（`dsh-session-title/lib/types/types.d.ts:34-41`） | `data.title` | ✅ 未变 |
| `turn/start` / `turn/end` | `dsh-session/lib/types/types.d.ts:263-277`；`TurnEndReason` 联合 `:166-209`，`error` 臂 `{ kind:'error'; error: LlmFailure }`；`LlmFailure { message; code; status?; … }`（`dsh-llm/lib/types/types.d.ts:26-30`） | `data.turn` / `data.reason.kind` / `reason.error.message` / `.code` | ✅ 未变 |
| `user/message`（标题兜底折叠） | `UserMessage extends MessageBase`，`MessageBase.content: readonly ContentBlock[]`（`dsh-llm/lib/types/message.d.ts:124-132, 144-146`） | `data.content[].type==='text'` / `.text` | ✅ 未变 |
| `ask_user_question` 工具名 | `dsh-user-questions/lib/index.js:93` `if (tool.name !== "ask_user_question") return false;` | `data.name === 'ask_user_question'` | ✅ 未变 |
| `plan-review` 呈现意图 | `dsh-user-questions` 的 `intent.kind` schema `const: "plan-review"`（另有 `approve` 字段） | `questions[].intent.kind === 'plan-review'` | ✅ 未变 |

`ApprovalRequestEvent`（`dsh-user-approval/lib/types/types.d.ts:55-71`）→ `{ agent; toolName; callId?; reason?; displayReason?; signal? }`，插件读取 `req.agent.session.id` / `req.callId` / `req.reason`：

- `req.agent.session.id` **仍成立**：运行时 `dsh-user-approval/lib/index.js:129` 自己就写 `const session = req.agent.session;`；类型面 `dsh-agent/lib/types/runtime-types.d.ts:142-143` 给 `Agent` 增补 `readonly session: Session`；公开面 `Agent { readonly id: SessionId }`（`dsh-agent/lib/types/types.d.ts:11-13`）只是基线，`session` 在 live 面存在。官方 `dsh-acp/lib/index.js:1164`（同一监听器 1158-1164）亦用 `record.agent.session.id`。

### c.3 唯一新增字段：`approval/asked.reason`（可利用）

`dsh-user-approval/lib/index.js:132-137`（运行时 append）：

```js
session.append("approval/asked", {
  id, toolName: req.toolName,
  ...req.callId !== void 0 ? { callId: req.callId } : {},
  ...req.reason !== void 0 ? { reason: req.reason } : {}
});
```

即 **0.2.1 起 reason 进了审计事件本体**（含 hook 的权限判定理由），插件原先"reason 不进审计事件、只能靠 `approval/request` waterfall 观察补"的前提在新版已不成立。

**修复说明**（`src/index.ts` `onEvent` 的 `approval/asked` 分支）：改为**双源、新源优先**：

```
reasonText = (typeof data.reason === 'string' && data.reason !== '')
  ? data.reason          // 0.2.1+：审计事件权威值
  : observed?.text       // ≤0.1.x：approval/request 观察者缓存（保留）
```

两源都取不到则**省略** `reason`（客户端按既有逻辑回退 toolName 展示，不报错）。孤儿恢复路径（`recoverAuditOf`）同样优先读事件自带 `reason`。waterfall 观察者**保留不放**——它是旧版唯一来源，且它现在是纯冗余观察（`next()` 照常放行，不干预审批链），删掉会破坏旧版兼容。

---

## d. `sessions.list()` / `sessions.get(id)` / `sessionEventsOf(session)`

**类型面证据**（`dsh-session/lib/types/index.d.ts`）：

```ts
get(id: SessionId): Session | undefined;   // :491  "Look up a live session."
list(): Session[];                         // :496  "All live sessions, in creation order."
snapshotEvents(fromSeq?, toSeqExclusive?): readonly SessionEvent[];  // :224
```

**逐条判定**：

1. `sessions.list()` / `sessions.get(id)` **仍存在、"仍然同步"**——0.2.0 的 session 重构**没有**把它们改成异步或投影形式（异步化的是新的 `dsh-session-query` 检索层，见"未解决项"）。
2. `Session.snapshotEvents()` **仍是同步全量快照**，`Session.events` 属性依旧不存在（这正是插件 `sessionEventsOf()` 先探 `snapshotEvents()`、再兜底 `.events` 的原因，`src/notify-host.ts:135`）。→ 审计事件读取路径**全部成立**。
3. ⚠️ **语义细化（本次唯一实质性行为差异）**：两个方法的文档措辞明确为 **live-only**（"a live session" / "All live sessions"）。**host 重启后 store 为空 → 仅靠启动扫描恢复不到任何孤儿项**，而 `session/event` 只报新事件，历史 `approval/asked`（无 `decided`）永远不会被重新登记——插件的核心卖点之一（"上次运行中断留下的未决审批"）在新版上会静默失效。
   - 该语义在旧版同样是内存 store，故这不是 0.2.1 **引入**的回归；但 0.2.1 把它写进了契约，且提供了新的恢复手段。

**修复说明**（`src/index.ts`）：

- 把启动扫描的循环体抽成 `recoverAuditOf(session)`（幂等：`pending` / `pendingQuestions` 已有同 id 即跳过）。
- 启动时仍对 `sessions.list()` 全量扫描一次；
- **新增** `ctx.on('session/created', (session) => recoverAuditOf(session))`。依据：`dsh-session/lib/types/index.d.ts:41` `'session/created'(this: Scoped<Session>, session: Session): void`，语义为"Creation announcement during session publication"；`dsh-agent` 的 resume 是"opens the persisted session for write, reads and repairs the log, **publishes it**"（`dsh-agent/lib/types/index.d.ts:174-175`），因此**会话被重新打开/resume 时，`snapshotEvents()` 已经含持久化历史**，孤儿审批/提问随之恢复。
- 跨版本安全：`ctx.on` 对未注册事件名是 no-op；`session/created` 在旧版若不存在，最坏情况是本补扫不触发，原有启动扫描行为不变。

---

## e. Web Push 链路（存储 / webhook / focus 抑制）

**结论：0.2.1 对这条链路无影响，无需改动。**

1. **`$DSH_HOME` 仍是权威 home 变量**：`dsh/lib/bin.js:105`（"--profile <name> … the profile under `$DSH_HOME/profiles`"）、`dsh-app-boot/lib/index.js:488`。插件 `dataDir()` = `$DSH_HOME/.meow-smooth`（fallback `~/.dsh/.meow-smooth`）继续有效。
   - **运行时确认**：重启后 `ensurePush()` 成功，`/tmp/dsh-test-home/.meow-smooth/vapid.json` 已生成（171B，publicKey 87 / privateKey 43）；`/plugins/meow-smooth/push-config` 返回 `{"enabled":true,"publicKey":"BMgMf-ZEphP2i2JPP_…"}`。
2. **`web-push` 依赖链未变**：`web-push@3.6.7` 仍在插件 `node_modules`，`build.mjs` 继续 `external: ['web-push']`，运行时动态 `import('web-push')` 走 Node ESM-CJS interop（bundle 内确认仍是 `import("web-push")`，未被打进来）。重启后无 `web push unavailable` 告警。
3. **webhook 通道**：纯 `fetch()` POST，与宿主版本无关，未受影响。
4. **`x-meow-focus` 抑制逻辑未受影响**：`/pending` handler 仍直接读 `req.headers`（`IncomingMessage.headers` 恒小写），`noteFocus(host, focused)` + 3s 窗口逻辑不变。0.2.1 的 `WebRoute.handler` 文档明确"Owns the full response lifecycle"（`dsh-host-webserver/lib/types/index.d.ts:38`），POST 体仍由 handler 自行 `req.on('data'/'end')` 收取，`push-subscribe` / `diag-log` 写法继续有效。
5. `sessionEventsOf(ctx?.sessions?.get?.(sessionId))`（标题折叠）依赖的 `sessions.get` 见上文 d 项，成立。

---

## f. 压缩代理的官方 gzip 探测与"默认关闭"安全默认

**结论：探测逻辑仍然正确；默认关闭仍然是安全默认。无需改动核心逻辑。**

1. **webserver 的 `compression` 配置**（`dsh-host-webserver/lib/types/index.d.ts:82-87`）：

   ```ts
   /** Response compression for socket-backed HTTP requests. @default 'none' */
   compression?: 'none' | 'gzip';
   /** Gzip DEFLATE level from 0 through 9. @default 1 */
   compressionLevel?: number;
   /** Minimum known response length eligible for gzip; … @default 1024 */
   compressionThresholdBytes?: number;
   ```

   → **包 schema 默认值已从"内置 gzip"变为 `'none'`**（插件头注释里"0.1.2+ 内置 compression:'gzip'"的描述已过时）。

2. **但官方 web 组合在 bundle 层显式打开 gzip**（`dsh-web-app/cordis.patch.yml:186-188`）：

   ```yaml
   - id: webserver
     name: '@deepseek-ai/dsh-host-webserver'
     config:
       …
       compression: gzip
       compressionLevel: 1
       compressionThresholdBytes: 1024
   ```

3. **运行时实测（17899，探测路径 = 插件自注册的 `sw.js`）**：

   ```
   $ curl -s -D- -o /dev/null -H 'accept-encoding: gzip' \
       http://127.0.0.1:17899/plugins/meow-smooth/sw.js
   HTTP/1.1 200 OK
   Vary: Accept-Encoding
   Content-Encoding: gzip
   ```

   → 候选路径 1 得到 `200 + gzip` → `detectOfficialGzip()` 返回 `true` → 代理按设计 `setMode('passthrough')`。**探测仍能正确判定**。

4. **探测设计本身是"测实际行为"而非"解析版本号"**，因此对配置差异天然正确：
   - 官方 web 组合（`compression: gzip`）→ 探测 `gzip` → passthrough，不再重复压缩；
   - 自定义组合不加该覆盖（schema 默认 `'none'`）→ 上游不压 → 探测 `plain` → 代理**保持 gzip 模式**（由代理来压），这正是期望的保守回退；
   - 双重压缩仍被 `upstreamEncoded` 兜住（`src/compress-proxy.ts:126-127`，上游一旦带 `content-encoding` 一律原样透传）。
   - 探测路径仍免鉴权（`sw.js` 是纯静态资源，不在 `authGate` 名单内），不会被 401 干扰——本次重启后实测 `sw.js` 无 cookie 也是 200。

5. **默认关闭仍是安全默认**：`src/index.ts` 的 `if (proxyCfg?.enabled === true)` 门槛未动——不配置 `proxy.enabled` 就**完全不进该分支**，不会 `listen` 任何端口。运行时确认：`ss -ltn | grep 8444` → 空。

**修复说明**：探测/降级逻辑零改动，仅补注释记录上述证据（`src/compress-proxy.ts` 的 `GZIP_PROBE_PATHS` 文档）。另新增**端口取权威值**能力（见下"附带修复"）。

---

## 附带修复（核对过程中发现的宿主侧问题）

### 1. 端口解析：优先 0.2.x 的权威 `webServer.port`

- **问题**：`resolveTargetPort()` 只解析 `process.argv` 的 `--port`，取不到就回退历史默认 `3080`。0.2.1 起 webserver 端口可以来自 profile 装配（`dsh-web-app/cordis.patch.yml:183-184` `host: !!js ctx.webStartup.host ?? '127.0.0.1'` / `port: !!js ctx.webStartup.port ?? 3080`）而非命令行——此时 argv 解析会**悄悄指向错误的端口**，压缩代理会转发到错误的 upstream，`probeHostManifestComplete` 也会探测失败（后者后果是"保守多注入一次 PWA link"，无害；前者会让手机链路直接不可用）。
- **修复**（`src/compress-proxy.ts` 新增 `resolveBoundPort(webServer)`）：
  1. 优先 `webServer.port`（`dsh-host-webserver/lib/types/index.d.ts:152` "The listening port (the OS-assigned value when config.port is 0), or undefined before listen binds"）；
  2. 次选 `getOrigin()`（`:167`，listen 前会 throw）解析端口；
  3. 全部不可用（旧版无这俩 getter / 尚未 listen）→ 回退 `resolveTargetPort()`（argv）。
  - 全程 `try/catch`，**绝不抛错**；`src/index.ts` 以闭包 `officialPort()` 懒解析（apply 阶段 webserver 可能尚未 listen），传给 `installNotifyHost(ctx, config, { port })` 用于 manifest 探测，并用于压缩代理的 `targetPort`。
  - `resolveTargetPort(explicit?)` 同步扩了一个可选显式端口参数，旧调用点语义不变。
- **跨版本安全**：旧版 `ctx.webServer` 无 `port`/`getOrigin` → 第 3 步 argv 回退，行为与改动前完全一致。

### 2. `HOST_VERSION` 与包版本失同步

- **问题**：`src/index.ts` 的 `HOST_VERSION` 长期停在 `'0.7.1'`，而 `package.json` 已是 `0.8.1`；注释明确要求"发版时随 package.json 的 version 一并更新"，`/pending` 会把它原样下发给客户端。
- **修复**：改为 `'0.8.1'`，运行时确认 `/pending` 返回 `{"hostVersion":"0.8.1",…}`。
- ⚠️ **需要 Lead 协同**：若最终发版把 `package.json` bump 到 0.8.2，这一行必须同步；Lead 已确认本次暂按 0.8.1 保留。

---

## 未解决项 / 后续可选优化

以下各项**不影响本次验收**，均已在代码里留出软取挂点或明确记录，供后续按需采纳。

1. **host 重启后的"全覆盖"孤儿恢复仍未做到（本次只做到"会话重开即恢复"）**
   - 现状：`sessions.list()` live-only → 重启后不打开会话就看不到孤儿项；已通过 `session/created` 补扫覆盖"用户重新打开该会话"的路径。
   - 0.2.1 提供了冷读通道：`ctx.sessionQuery`（`dsh-session-query/lib/types/index.d.ts:25` `sessionQuery: SessionQueryEngine`），`readSession(sessionId)`（`:74`）/ `listSessions()`（`:67`）/ `listEvents(sessionId)`（`:111`）可读**已持久化但未 live** 的会话日志，且官方 web 组合确实装配了它（`dsh-base/cordis.patch.yml:158` 装配 `@deepseek-ai/dsh-session-query-sqlite`，其 `lib/index.js:476` 继承 `SessionQueryEngine`，抽象服务的 `super(ctx,"sessionQuery")` 在 `dsh-session-query/lib/index.js:1048`）。
   - 未做的原因：该路线是异步 + 取决于持久化后端可读性（`dsh-base/cordis.patch.yml` 注释说明该后端以 `path: ':memory:'` / `openAt: never` 装配，搜索被禁用、精确读承诺可用），属于**功能增强而非兼容修复**，贸然引入会把"只读聚合路由"变成对检索服务的硬依赖，风险大于收益。建议单独排一个需求验证后再做（软取 `ctx.get('sessionQuery')` + 失败静默即可保持跨版本安全）。
2. **`snapshotEvents()` 全量快照的轮询开销**：0.2.1 的 `snapshotEvents(fromSeq?, toSeqExclusive?)` 支持区间读；当前 `commandFor()` / `sessionTitleOf()` 每次轮询都取全量并线性扫。长会话（数万事件）+ 高频轮询下有优化空间，但当前实现正确，未改（避免引入增量折叠的边界 bug）。
3. **官方提问投影未接入**：0.2.1 有 `userQuestions: UserQuestionService`（`dsh-user-questions/lib/types/index.d.ts:16`，`lib/index.js:490` `super(ctx,"userQuestions")`）与 `ask_user_question` 事件投影（`lib/types/projection.js`）。插件目前自折叠 `pendingQuestions`（跨版本可用）。若未来要更准的"可回答/已结算"判定，可软取该服务做交叉校验，而不是替换现有折叠。
4. **官方结构化 index 注入未迁移**：`webserver/index-inject` + `IndexInjection` 行（`dsh-host-webserver/lib/types/injections.d.ts`）比 `tapIndex` 字符串替换更健壮（不依赖 `<head>` 字面匹配）。但官方明确 `tapIndex` 仍是保留通道（`index.d.ts:191-198`），且运行时确认注入行为未变（插件 link 仍排在本体 `rel="manifest"` 之前生效），故本次不迁移。**风险提示**：插件的幂等锚点是 `html.includes('/plugins/meow-smooth/icon-180.png')`、拼装点是 `html.replace('<head>', …)`，一旦未来本体 index.html 不再有字面 `<head>` 标签，注入会静默失效——若要长期稳妥，建议迁移到结构化行。
5. **`lib/client.js`（浏览器半边）不在本报告范围**：由 client-compat 负责；本报告只覆盖 host。

---

## 附：验证记录（重启后，全部为原始输出）

实例：`cd /tmp && DSH_HOME=/tmp/dsh-test-home nohup dsh --profile meowtest --port 17899 --no-open > /tmp/meowtest-boot.log 2>&1 &`
启动日志（无任何插件报错/告警）：

```
dsh web: http://127.0.0.1:17899/?token=P1iqVyO4d_VdrmQx_SAx4BUpHvupmb8QyCenChwBC3E
```

| 检查 | 命令要点 | 结果 |
|---|---|---|
| 鉴权闸生效 | `curl -i .../pending`（无 cookie） | `401 Unauthorized` |
| **主验收** | token 换 cookie 后 `curl -i -b cookies.txt .../pending` | **`200` + `{"hostVersion":"0.8.1","approvals":[],"questions":[],"events":[]}`** |
| 路由回归 | 8 条路由逐个 curl | 见 b 项表格，全部符合预期 |
| gzip 探测 | `curl -D- -H 'accept-encoding: gzip' .../sw.js` | `200` + `Vary: Accept-Encoding` + `Content-Encoding: gzip` |
| 代理默认关闭 | `ss -ltn \| grep 8444` | 空（未占端口） |
| Push 存储 | `ls /tmp/dsh-test-home/.meow-smooth/` | `vapid.json`（171B，keys 已持久化） |
| index 注入 | `curl -b cookies.txt / \| grep '<head>'` | `<head><base …><link rel="manifest" href="/plugins/meow-smooth/manifest.json"><link rel="apple-touch-icon" …` |

构建与类型检查：

- `node build.mjs` → 通过（`lib/index.js` 44.0kb、`lib/client.js` 112.3kb）。
- `./node_modules/.bin/tsc --noEmit -p tsconfig.json` → **host 四个文件 0 错误**；唯一报错为 `src/client.ts(2334,5) TS2322`，经确认**先于本次改动即存在**，属浏览器半边（client-compat）范围，已上报 Lead。
- **交付完整性**：文档定稿前又对源码做了若干**纯注释**修订（补 file:line 证据），随后重新 `node build.mjs` 并比对产物 md5——`lib/index.js` 与 `lib/client.js` 与上文运行时验证所用的那一份**逐字节相同**（`md5sum -c` 全部 OK），因此上表的运行时结论对最终源码同样成立，无需二次重启复验。

引用校验：本报告所有 `包名/file:line` 断言均用脚本对 0.2.1-rc.2 产物逐行回读校验（`sed -n "<line>p"` + 断言文本匹配），校验中修正了 6 处行号偏差：`:168-171`→`:169-170`、`dsh-session-title .../types.d.ts:38-45`→`:34-41`、`runtime-types.d.ts:139-141`→`:142-143`、`dsh-acp ...:1162`→`:1164`、`cordis .../fiber.d.ts:47`→`:50`、`dsh-agent .../types.d.ts:11-14`→`:11-13`。