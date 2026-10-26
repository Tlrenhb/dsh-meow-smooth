/**
 * meow-smooth — 喵丝滑（host 端）。
 *
 * 纯 client 行为增强插件：浏览器端逻辑见 src/client.ts。
 * host 侧职责（需求 12：手机端 pending 权限申请任何时刻可见）：
 *
 * 1. 审批审计投影：监听会话审计流——approval/asked 登记 pending、
 *    approval/decided 移除；启动时扫描已挂会话的事件恢复未决项。
 *    覆盖 apiproxy 的覆盖盲区：它的 pending 是进程内存，host 重启即丢
 *    （mux replay 无从重放），而审计日志里"asked 无 decided"的项就是
 *    上次运行中断留下的未决审批。
 * 2. reason 观察者：approval/request waterfall 纯观察（必须 next()
 *    放行，绝不干预审批链），在 approval/asked 登记后按
 *    (sessionId, callId) 补上 reason（reason 不进审计事件）。
 * 3. 只读状态路由 GET /plugins/meow-smooth/pending：返回全部未决审批的
 *    细节（toolName/reason/callId/command/askedAt/orphan），client
 *    端轮询用。只读聚合，无任何写操作。
 */

/** 一条投影出的未决审批（结构子集，字段以 dsh-user-approval 审计事件
 *  契约为准；不 import 宿主包——esbuild 全量打进 bundle 会复制一份
 *  cordis 类导致双实例冲突）。 */
interface PendingApprovalView {
  sessionId: string
  approvalId: string
  toolName: string
  callId?: string
  reason?: string
  askedAt: number
  /** host 重启后从审计恢复的项：apiproxy 已无对应 rpcId，无法应答。 */
  orphan: boolean
}

/** 一条投影出的未决提问（key=callId）。提问无专用审计事件（只有 approval
 *  有 asked/decided 对），从 tool/call(ask_user_question) 登记、
 *  tool/result(message.source.callId 配对) 移除——审计日志持久，host
 *  重启/客户端断线重连后仍可恢复（client 帧链路的权威兜底：client 的
 *  pendingInteractions 断线清空后靠 mux 重放恢复，iOS 丢帧即永久缺失）。 */
interface PendingQuestionView {
  sessionId: string
  callId: string
  askedAt: number
  /** plan-review 呈现意图（questions 里任一 intent.kind === 'plan-review'）。 */
  planReview: boolean
  /** host 重启后从审计恢复的项：apiproxy 已无对应 rpcId，无法应答。 */
  orphan: boolean
  /** 会话标题（折叠 session/title 事件；client 快照标题缺失时兜底，
   *  修手机端"未命名会话"显示问题）。 */
  title?: string
}

import { installNotifyHost, sessionEventsOf } from './notify-host.ts'
import { startCompressProxy, resolveBoundPort, detectOfficialGzip } from './compress-proxy.ts'
import { connectionAuthOf, authGate } from './auth-gate.ts'

/** 插件名（loader 诊断用；与 cordis.patch.yml 的 name 一致）。 */
export const name = 'meow-smooth'

/** host 半边功能版本标记（/pending 响应带出，客户端可探测运行实例的
 *  host 是否含某能力——如失败事件需要 v0.4.0+）。发版时随 package.json
 *  的 version 一并更新（2026-10-25：包已是 0.8.1，此前常量滞留在 0.7.1；
 *  2026-10-26 Lead 发版 0.8.2——dsh 0.2.1-rc.2 适配版，两处保持同步）。 */
export const HOST_VERSION = '0.8.2'

/** webServer 服务最小面（仅登记一批只读状态路由；注册返回 dispose）。 */
interface WebServerFace {
  register(state: {
    kind: string
    path: string
    handler: (req: unknown, res: {
      writeHead: (code: number, headers: Record<string, string>) => void
      end: (body?: string) => void
    }) => void
  }): unknown
}

/** 必需服务声明：sessions 由 client-runtime 提供（dsh-femo 同款声明）。
 *  webServer 必须显式声明（2026-08-20 实测）：rc.6 的 include 装配下
 *  ctx.get('webServer') 对未声明服务返回 undefined → 路由静默跳过
 *  （/pending 404；崩溃重启后 3080 复现）；声明后走属性访问，与
 *  dsh-super-injector 同款可靠路径。3081（新版 cordis）双路径均可用。
 *  connection（2026-09-13 安全修复）：动态路由鉴权闸依赖
 *  connection.requestRejection（官方 /api 同闸）；web profile 必有此服务
 *  （dsh-client-connection），与 usage-query 插件的声明方式一致。
 *
 *  2026-10-25 对 dsh 0.2.1-rc.2 逐条核对：三个服务名**全部未变**——
 *  sessions: dsh-session/lib/types/index.d.ts:28 + `super(ctx,"sessions")`
 *  (lib/index.js:1739)；webServer: dsh-host-webserver/lib/types/index.d.ts:18
 *  + lib/index.js:286；connection: dsh-client-connection/lib/types/rpc-host.d.ts:10
 *  + lib/index.js:710。官方 0.2.1 插件同样以 `inject: ["webServer","connection",…]`
 *  声明（dsh-host-open-in-app/lib/index.js:1160-1163），声明方式无需改动。 */
export const inject = ['sessions', 'webServer', 'connection']

/** 插件配置（cordis.patch.yml 可覆盖；通知模块消费 longTaskToolCalls 与
 *  vapid keys，其余字段兼容既有配置）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Config extends Record<string, any> {
  /** 判定"长任务"的工具调用次数阈值（turn 内 tool/call 数，默认 7）。 */
  longTaskToolCalls?: number
  /** Web Push VAPID 公钥（不配则自动生成并持久化）。 */
  vapidPublicKey?: string
  /** Web Push VAPID 私钥（不配则自动生成并持久化）。 */
  vapidPrivateKey?: string
  /** 通用 webhook 通知 URL（可选，如 Bark https://api.day.app/<key>）：
   *  审批/提问/长任务完成时 POST JSON，手机系统通知的替代通道
   *  （iOS Web Push 被系统 bug 卡死时用）。 */
  webhookUrl?: string
  /** Bark 通知图标（https URL，如 dsh 插件图标路由）。 */
  webhookIconUrl?: string
  /** Bark 通知点击跳转地址（https URL，如 dsh 的 tailscale 入口）。 */
  webhookAppUrl?: string
  /** 压缩代理（手机访问加速，默认关闭）：port=代理监听端口（默认 8444）；
   *  targetPort 自动从 dsh --port 解析。开启后把 tailscale serve 等反代
   *  指向 127.0.0.1:<port>。零 dsh 本体改动，见 src/compress-proxy.ts。
   *  版本自适应：旧版 dsh 以 gzip 模式运行（现状）；dsh 0.1.2+ 官方已
   *  内置 gzip，启动时自动探测并降级为纯透传（无需改任何配置）。
   *  探测走本插件自注册的 /plugins/meow-smooth/pending（新旧版都在），
   *  不再依赖 0.1.5 起已 404 的 /plugins/<id>/client.js，见 compress-proxy.ts。 */
  proxy?: {
    enabled?: boolean
    port?: number
    targetPort?: number
  }
}

/** Host loader entry for the browser-only fold plugin. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: any, config?: Config): void {
  // cordis 严格模式：ctx.<service> 属性必须经 inject 声明；可选服务用
  // ctx.get(name) 读全局 store（未注册返回 undefined → 对应能力降级）。
  // rc.6 include 装配下 ctx.get 不命中未声明服务（实测 404）→ 先试
  // 属性访问（inject 已声明），再回退 ctx.get；两版 cordis 都兼容。
  let webServer: WebServerFace | undefined
  try { webServer = ctx.webServer as WebServerFace | undefined } catch { webServer = undefined }
  if (webServer === undefined && typeof ctx.get === 'function') {
    try { webServer = ctx.get('webServer') as WebServerFace | undefined } catch { webServer = undefined }
  }
  const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
  /** dsh 本体真实监听端口（懒解析）：0.2.x 优先 webServer.port 权威 getter
   *  （profile 配置端口而非 --port 启动时 argv 解析会失真），旧版回退 argv。
   *  用闭包而非立即求值：apply 阶段 webserver 可能尚未 listen。 */
  const officialPort = (): number => resolveBoundPort(webServer)
  // 通知模块（需求 15）：长任务完成队列 + PWA 资源 + Web Push 推送器。
  const notify = installNotifyHost(ctx, config, { port: officialPort })
  // 压缩代理（config.proxy.enabled，默认关闭）：手机访问加速，零本体改动。
  // targetPort 自动从 dsh --port 解析；随插件 fiber 销毁（热重载/卸载即停）。
  // 版本自适应 if 框架：先按旧版行为同步启动 gzip 模式（旧版 dsh 路径与
  // 历史完全一致），随后异步探测官方 gzip（dsh 0.1.2+ webserver 内置）——
  // 探测到即 setMode('passthrough') 切纯透传（同一 server，零断流），
  // tailscale serve 指向无需变动；探测不到保持 gzip 模式（保守回退）。
  // 探测路径本身跨版本存活（见 compress-proxy.ts 的 GZIP_PROBE_PATHS）。
  const proxyCfg = config?.proxy
  if (proxyCfg?.enabled === true) {
    // 默认关闭（proxyCfg.enabled !== true 即整个分支不进）：不配置就绝不占用
    // 8444 —— 0.2.1 核对后确认这仍是安全默认（实测 17899/17890 均无 8444 监听）。
    const targetPort = proxyCfg.targetPort ?? officialPort()
    const { server, setMode } = startCompressProxy({
      port: proxyCfg.port ?? 8444,
      targetPort,
    })
    if (typeof ctx.effect === 'function') {
      // cordis effect 语义：execute 立即执行，返回的 disposer 在 fiber 卸载时
      // 调用（热重载/卸载即停）。把关闭逻辑放进返回的 disposer。
      ctx.effect(() => () => {
        server.close()
        // Node 18.2+：强制断开残留连接，避免热重载时代理端口滞留。
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      }, 'meow-smooth: compress proxy')
    }
    void detectOfficialGzip(targetPort).then((officialGzip) => {
      if (officialGzip) {
        setMode('passthrough')
        console.log('[meow-smooth] official dsh gzip detected — proxy switched to passthrough (phone link unchanged)')
      } else {
        console.log('[meow-smooth] no official gzip on dsh (legacy) — proxy keeps gzip compression')
      }
    })
  }
  const pending = new Map<string, PendingApprovalView>()
  const pendingQuestions = new Map<string, PendingQuestionView>()
  /** 待消费的 reason 观察记录：key = `sessionId|callId`。approval/request
   *  在 approval/asked append 后的微任务 dispatch，asked 事件先到、登记
   *  pending，随后观察者补 reason；消费即删。带时间戳，定期清理防泄漏。 */
  const reasons = new Map<string, { text: string; at: number }>()
  let requestSeen = 0

  // --- reason 观察者（waterfall 必须 next 放行）---
  if (typeof ctx.on === 'function') {
    ctx.on('approval/request', (req: any, next: () => Promise<unknown>) => {
      try {
        requestSeen++
        if (requestSeen % 50 === 0) {
          const cutoff = Date.now() - 10 * 60_000
          for (const [key, value] of reasons) {
            if (value.at < cutoff) reasons.delete(key)
          }
        }
        const sessionId: string | undefined = req?.agent?.session?.id
        const callId: string | undefined = req?.callId
        if (typeof sessionId === 'string' && typeof req?.reason === 'string' && req.reason !== '') {
          reasons.set(`${sessionId}|${callId ?? ''}`, { text: req.reason, at: Date.now() })
        }
      } catch {
        // 观察失败不影响审批链（next 照常放行）。
      }
      return next()
    })
  }

  /** 从 tool/call arguments（JSON 字符串）判定 plan-review 呈现意图：
   *  questions 里任一 intent.kind === 'plan-review'（与官方面板
   *  planReviewOf 同判定；detail 存在性不影响横幅分类）。解析失败一律
   *  按普通提问登记（跳转后官方面板显示真实内容）。 */
  const planReviewOf = (raw: unknown): boolean => {
    try {
      const args = JSON.parse(typeof raw === 'string' ? raw : '') as { questions?: Array<{ intent?: { kind?: string } }> }
      const questions = args?.questions
      return Array.isArray(questions) && questions.some(q => q?.intent?.kind === 'plan-review')
    } catch {
      return false
    }
  }

  /** 折叠会话标题：审计流 session/title 事件 last-wins（与官方
   *  foldSessionTitle 同语义；未命名返回空，由客户端兜底文案显示）。 */
  const sessionTitleOf = (session: any): string => {
    try {
      const events = sessionEventsOf(session)
      if (!Array.isArray(events)) return ''
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i] as { type?: string; data?: { title?: unknown } } | undefined
        if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title !== '') {
          return event.data.title
        }
      }
    } catch {
      // 标题折叠失败返回空（未命名兜底）。
    }
    return ''
  }

  // --- 审计投影 ---
  const onEvent = (session: any, event: any): void => {
    try {
      const data = event?.data
      if (event?.type === 'approval/asked') {
        const id: string = data?.id ?? ''
        if (id === '') return
        const sessionId: string = session?.id ?? ''
        const callId: string | undefined = data?.callId
        const key = `${sessionId}|${callId ?? ''}`
        const observed = reasons.get(key)
        if (observed !== undefined) reasons.delete(key)
        // reason 双源（跨版本）：dsh 0.2.1-rc.2 起 approval/asked 审计事件
        // **自带** reason 字段（dsh-user-approval/lib/types/types.d.ts:41，
        // 运行时 append 见 lib/index.js:132-137）——这是权威源，含 hook 的
        // 权限判定理由；旧版（≤0.1.x）事件无该字段，回退到 approval/request
        // waterfall 观察者缓存的 req.reason（见上方 reasons map）。
        // 两源都取不到则省略 reason（客户端回退 toolName 展示，不报错）。
        const reasonText: string | undefined = typeof data?.reason === 'string' && data.reason !== ''
          ? data.reason
          : observed?.text
        pending.set(id, {
          sessionId,
          approvalId: id,
          toolName: data?.toolName ?? '',
          ...(callId !== undefined ? { callId } : {}),
          ...(reasonText !== undefined ? { reason: reasonText } : {}),
          askedAt: Date.now(),
          orphan: false,
        })
        // 通知钩子（需求 15）：审批登记 → Web Push（页面内通知由 client
        // 轮询 pending 触发；此处覆盖页面关闭/后台场景）。
        notify.pushApproval({
          sessionId,
          approvalId: id,
          toolName: data?.toolName ?? '',
          ...(reasonText !== undefined ? { reason: reasonText } : {}),
        })
      } else if (event?.type === 'approval/decided') {
        const id: string = data?.id ?? ''
        if (id !== '') pending.delete(id)
      } else if (event?.type === 'tool/call' && data?.name === 'ask_user_question') {
        const callId: string = data?.callId ?? ''
        if (callId === '' || pendingQuestions.has(callId)) return
        const sessionId: string = session?.id ?? ''
        pendingQuestions.set(callId, {
          sessionId,
          callId,
          askedAt: Date.now(),
          planReview: planReviewOf(data?.arguments),
          orphan: false,
          ...(sessionTitleOf(session) !== '' ? { title: sessionTitleOf(session) } : {}),
        })
      } else if (event?.type === 'tool/result') {
        // 配对字段：tool/result 的 callId 在 message.source.callId（core
        // 契约，repair 会给中断的工具补合成 result，故最终必有配对）。
        const callId: unknown = data?.message?.source?.callId
        if (typeof callId === 'string') pendingQuestions.delete(callId)
      }
    } catch {
      // 投影失败静默：轮询接口仍返回已有数据。
    }
  }
  if (typeof ctx.on === 'function') ctx.on('session/event', onEvent)

  // --- 审计流恢复：折叠一个会话的完整日志，登记"asked 无 decided"的孤儿项
  // （先注册监听再扫描，旧事件不重放，无重复；孤儿项打 orphan 标记，
  // 客户端据此提示"可能已失效"）---
  //
  // dsh 0.2.1-rc.2 核对：`sessions.list()` / `sessions.get(id)` 仍同步可用，
  // 但语义是**只返回 live 会话**（dsh-session/lib/types/index.d.ts:491
  // "Look up a live session"、:496 "All live sessions, in creation order"）——
  // host 重启后 store 为空，仅靠启动扫描恢复不到任何东西。因此额外挂在
  // `session/created`（:41，会话发布/恢复时同步广播）上：resume 会先把持久化
  // 日志读回来再发布，此时 snapshotEvents() 已含历史 → 会话被重新打开时
  // 孤儿审批/提问照样恢复。幂等：pending / pendingQuestions 已有同 id 即跳过。
  //
  // @param session - `sessions.list()` 或 `session/created` 给出的会话对象。
  const recoverAuditOf = (session: any): void => {
    try {
      const sessionId: string = session?.id ?? ''
      const events: any[] | undefined = sessionEventsOf(session)
      if (!Array.isArray(events)) return
      const decided = new Set<string>()
      for (const event of events) {
        if (event?.type === 'approval/decided' && typeof event.data?.id === 'string') {
          decided.add(event.data.id)
        }
      }
      for (const event of events) {
        if (event?.type !== 'approval/asked') continue
        const id: unknown = event.data?.id
        if (typeof id !== 'string' || id === '') continue
        if (decided.has(id) || pending.has(id)) continue
        const callId: unknown = event.data?.callId
        pending.set(id, {
          sessionId,
          approvalId: id,
          toolName: typeof event.data?.toolName === 'string' ? event.data.toolName : '',
          ...(typeof callId === 'string' ? { callId } : {}),
          // 审计事件自带的 reason（0.2.1+）在有值时优先；旧版事件无该字段。
          ...(typeof event.data?.reason === 'string' && event.data.reason !== ''
            ? { reason: event.data.reason }
            : {}),
          askedAt: Date.now(),
          orphan: true,
        })
      }
      // 提问孤儿恢复：tool/call(ask_user_question) 无配对 tool/result。
      const decidedCalls = new Set<string>()
      for (const event of events) {
        const resultCallId: unknown = event?.data?.message?.source?.callId
        if (event?.type === 'tool/result' && typeof resultCallId === 'string') {
          decidedCalls.add(resultCallId)
        }
      }
      for (const event of events) {
        if (event?.type !== 'tool/call' || event.data?.name !== 'ask_user_question') continue
        const callId: unknown = event.data?.callId
        if (typeof callId !== 'string' || callId === '') continue
        if (decidedCalls.has(callId) || pendingQuestions.has(callId)) continue
        const title = sessionTitleOf(session)
        pendingQuestions.set(callId, {
          sessionId,
          callId,
          askedAt: Date.now(),
          planReview: planReviewOf(event.data?.arguments),
          orphan: true,
          ...(title !== '' ? { title } : {}),
        })
      }
    } catch {
      // 恢复失败静默（单会话失败不影响其它会话 / 路由可用性）。
    }
  }
  try {
    if (sessions !== undefined && typeof sessions.list === 'function') {
      for (const session of sessions.list()) recoverAuditOf(session)
    }
  } catch {
    // 启动恢复失败静默。
  }
  if (typeof ctx.on === 'function') {
    // 会话发布/恢复（含 resume 已持久化日志）→ 补扫历史审计流。
    ctx.on('session/created', (session: any) => { recoverAuditOf(session) })
  }

  /** 按 callId 在会话事件里懒查命令文本（bash/pwsh 族 args.command；
   *  找不到省略）。轮询时现算，无常驻扫描。 */
  const commandFor = (view: PendingApprovalView): string | undefined => {
    if (view.callId === undefined) return undefined
    try {
      const session = sessions?.get?.(view.sessionId)
      const events = sessionEventsOf(session)
      if (!Array.isArray(events)) return undefined
      for (let i = events.length - 1; i >= 0; i -= 1) {
        const event = events[i] as { type?: string; data?: { callId?: unknown; arguments?: string } } | undefined
        if (event?.type !== 'tool/call' || event.data?.callId !== view.callId) continue
        try {
          const args = JSON.parse(event.data.arguments ?? '') as Record<string, unknown>
          return typeof args.command === 'string' ? args.command : undefined
        } catch {
          return undefined
        }
      }
    } catch {
      // 查不到省略。
    }
    return undefined
  }

  // --- 只读状态路由 ---
  if (webServer !== undefined && typeof webServer.register === 'function') {
    // 鉴权闸（2026-09-13 安全修复）：/pending 暴露未决审批细节（含命令
    // 文本），必须与官方 /api 同闸（connection.requestRejection）。
    const connection = connectionAuthOf(ctx)
    // 注册语义（0.2.1-rc.2 核对）：`register(route: WebRoute): () => void`
    // 签名未变（dsh-host-webserver/lib/types/index.d.ts:174），返回的正是
    // 该路由的 disposer；WebRoute = {kind:'exact'|'prefix', path, handler}
    // （:32-40）。**新增约束：重复 (kind, path) 会 throw**（:169-170
    // "Duplicate (kind, path) throws"）——热重载若旧 fiber 未先释放路由，
    // 直注册会直接把插件装配打挂。官方 0.2.1 的写法是
    // `ctx.effect(() => ctx.webServer.register({...}), label)`
    // （dsh-host-open-in-app/lib/index.js:1271），注册与释放同一 effect
    // 全生命周期；此处对齐该写法，并把 register 包进 try/catch →
    // 路由撞车只降级（/pending 不可用 + 告警），不抛错、不影响其余能力。
    const ws: WebServerFace = webServer
    const registerPendingRoute = (): (() => void) => {
      try {
        // register 返回的即该路由的 disposer（0.2.1 契约：() => void），
        // WebServerFace 声明为 unknown → 收窄。
        return ws.register({
          kind: 'exact',
          path: '/plugins/meow-smooth/pending',
          handler: authGate(connection, (req: unknown, res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body?: string) => void }) => {
            try {
              // 页面聚焦上报（x-meow-focus 头：1=页面聚焦）：任一页面聚焦时
              // host 抑制 Web Push 系统通知（卡片气泡负责提醒）。
              const headers = (req as { headers?: Record<string, string | undefined> })?.headers
              const focus = headers?.['x-meow-focus']
              if (focus === '1' || focus === '0') {
                notify.noteFocus(headers?.['host'], focus === '1')
              }
              const approvals = [...pending.values()].map((view) => {
                const command = commandFor(view)
                return {
                  sessionId: view.sessionId,
                  approvalId: view.approvalId,
                  toolName: view.toolName,
                  ...(view.callId !== undefined ? { callId: view.callId } : {}),
                  ...(view.reason !== undefined ? { reason: view.reason } : {}),
                  ...(command !== undefined ? { command } : {}),
                  askedAt: view.askedAt,
                  orphan: view.orphan,
                }
              })
              const questions = [...pendingQuestions.values()].map((view) => ({
                sessionId: view.sessionId,
                callId: view.callId,
                planReview: view.planReview,
                askedAt: view.askedAt,
                orphan: view.orphan,
                ...(view.title !== undefined ? { title: view.title } : {}),
              }))
              res.writeHead(200, {
                'content-type': 'application/json; charset=utf-8',
                'cache-control': 'no-store',
              })
              res.end(JSON.stringify({ hostVersion: HOST_VERSION, approvals, questions, events: notify.completionEvents() }))
            } catch {
              res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
              res.end('{"error":"internal"}')
            }
          }),
        }) as () => void
      } catch (error) {
        console.warn(`[meow-smooth] pending route registration failed: ${String(error).slice(0, 160)}`)
        return () => { /* 注册失败：能力降级，宿主装配不受影响 */ }
      }
    }
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => registerPendingRoute(), 'meow-smooth: pending route')
    } else {
      // 无 ctx.effect 的旧 cordis：只能直注册（无 disposer）。
      registerPendingRoute()
    }
  }
}
