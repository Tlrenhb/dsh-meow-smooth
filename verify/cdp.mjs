#!/usr/bin/env node
/**
 * verify/cdp.mjs — meow-smooth × dsh 0.2.1-rc.2 端到端验证用的可复用 CDP 探针。
 *
 * 手写 CDP 客户端（node >= 22 自带全局 WebSocket），不依赖 puppeteer/playwright。
 *
 * 能力：
 *   - launchChromium(): 起一个干净的 headless chromium（临时 user-data-dir，自动挑空闲端口）
 *   - connect(port):    连到已存在的 chromium（--remote-debugging-port=<port>）
 *   - setViewport():    移动视口 390x844（touch + deviceScaleFactor 2）/ 桌面视口 1440x900
 *   - authAndGoto():    先访问带 token 的 URL 让 shell 种 cookie，再进应用根路径
 *   - 事件采集：console / pageerror(Runtime.exceptionThrown) / Log.entryAdded /
 *     Network.loadingFailed / Network.responseReceived(status>=400)，另加
 *     addScriptToEvaluateOnNewDocument 注入的 window.__verifyErrors 早鸟捕获
 *   - evaluate()/waitFor()/waitForSelector()：断言原语（返回结构化结果，不抛异常给调用方做判定）
 *   - screenshot()：截图落盘
 *
 * CLI（调试用）：
 *   node verify/cdp.mjs --url http://127.0.0.1:17899 --token <t> \
 *        --viewport mobile|desktop --eval '<js>' [--shot out.png] [--wait 4000]
 *   node verify/cdp.mjs --url ... --selectors '[data-composer-card],[data-input-scroll]'
 *   node verify/cdp.mjs --url ... --dump-dom            # 打印关键 DOM 摘要 JSON
 *
 * 设计约束：任何一次 launcher 调用都是「干净 profile + 明确视口」，保证 Lead 复跑结果稳定。
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

export const CHROMIUM = process.env.CHROMIUM ?? '/usr/bin/chromium'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 存活的 chromium 进程登记表：脚本异常退出/被 Ctrl-C 时兜底清理，
 *  避免留下占端口吃内存的孤儿浏览器（实测会互相干扰后续跑测）。 */
const liveBrowsers = new Set()
function killGroup(proc) {
  if (!proc || proc.killed) return
  try { process.kill(-proc.pid, 'SIGKILL') } catch { try { proc.kill('SIGKILL') } catch {} }
}
let cleanupHooked = false
function hookCleanup() {
  if (cleanupHooked) return
  cleanupHooked = true
  const bye = () => { for (const p of liveBrowsers) killGroup(p) }
  process.on('exit', bye)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { bye(); process.exit(130) })
}

/** 移动视口（iPhone 12/13/14 逻辑尺寸）——插件的窄屏/触屏分支都由它触发。 */
export const VIEWPORT_MOBILE = { width: 390, height: 844, mobile: true, deviceScaleFactor: 2, touch: true }
/** 桌面视口。 */
export const VIEWPORT_DESKTOP = { width: 1440, height: 900, mobile: false, deviceScaleFactor: 1, touch: false }

export function viewportOf(name) {
  if (name === 'mobile' || name === '390x844') return VIEWPORT_MOBILE
  if (name === 'desktop' || name === '1440x900') return VIEWPORT_DESKTOP
  const m = /^(\d+)x(\d+)$/.exec(String(name))
  if (m) return { width: Number(m[1]), height: Number(m[2]), mobile: Number(m[1]) < 700, deviceScaleFactor: 1, touch: Number(m[1]) < 700 }
  throw new Error(`unknown viewport: ${name}`)
}

/** 从 dsh 启动日志里抠出带 token 的 URL（形如 http://127.0.0.1:17899/?token=xxx）。 */
export function readBootUrl(logPath) {
  if (!existsSync(logPath)) throw new Error(`boot log not found: ${logPath}`)
  const text = readFileSync(logPath, 'utf8')
  const m = text.match(/https?:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9._~-]+)/)
  if (!m) throw new Error(`no token URL in ${logPath}`)
  return { port: Number(m[1]), token: m[2], url: m[0], base: `http://127.0.0.1:${m[1]}` }
}

async function portFree(port) {
  return await new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function pickPort(start = 9333, tries = 60) {
  for (let p = start; p < start + tries; p += 1) if (await portFree(p)) return p
  throw new Error(`no free debugging port near ${start}`)
}

/** 等待 CDP HTTP 端点就绪。 */
async function waitCdpEndpoint(port, { timeout = 20000 } = {}) {
  const deadline = Date.now() + timeout
  let lastErr = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return await res.json()
    } catch (err) { lastErr = err }
    await sleep(150)
  }
  throw new Error(`CDP endpoint 127.0.0.1:${port} not ready: ${lastErr?.message ?? 'timeout'}`)
}

/**
 * 一个页面级探针。
 * 事件都收集到 this.events；辅助分类器见 errors()/failedRequests()。
 */
export class Probe {
  constructor({ ws, port, proc = null, userDataDir = null, targetId = null }) {
    this.ws = ws
    this.port = port
    this.proc = proc
    this.userDataDir = userDataDir
    this.targetId = targetId
    this._id = 0
    this._pending = new Map()
    this._handlers = new Map()
    this.events = []
    this.consoleEvents = []
    this.pageErrors = []
    this.logEntries = []
    this.requestFailed = []
    this.httpErrors = []
    this.requests = []
    this.closed = false
    ws.onmessage = (ev) => this._onMessage(ev)
    ws.onclose = () => { this.closed = true }
  }

  _onMessage(ev) {
    let msg
    try { msg = JSON.parse(ev.data) } catch { return }
    if (msg.id !== undefined && this._pending.has(msg.id)) {
      const { resolve, reject, method } = this._pending.get(msg.id)
      this._pending.delete(msg.id)
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
      else resolve(msg.result)
      return
    }
    if (!msg.method) return
    const rec = { method: msg.method, params: msg.params, at: Date.now() }
    this.events.push(rec)
    switch (msg.method) {
      case 'Runtime.consoleAPICalled': this.consoleEvents.push(rec); break
      case 'Runtime.exceptionThrown': this.pageErrors.push(rec); break
      case 'Log.entryAdded': this.logEntries.push(rec); break
      case 'Network.loadingFailed': this.requestFailed.push(rec); break
      case 'Network.requestWillBeSent': {
        this.requests.push({ requestId: msg.params?.requestId, url: msg.params?.request?.url, method: msg.params?.request?.method, at: rec.at, type: msg.params?.type })
        break
      }
      case 'Network.responseReceived': {
        const s = msg.params?.response?.status ?? 0
        if (s >= 400) this.httpErrors.push({ url: msg.params?.response?.url, status: s })
        break
      }
      default: break
    }
    const list = this._handlers.get(msg.method)
    if (list) for (const fn of list) { try { fn(msg.params) } catch { /* handler 异常不打断 */ } }
  }

  on(method, fn) {
    if (!this._handlers.has(method)) this._handlers.set(method, [])
    this._handlers.get(method).push(fn)
    return () => {
      const l = this._handlers.get(method) ?? []
      const i = l.indexOf(fn)
      if (i >= 0) l.splice(i, 1)
    }
  }

  send(method, params = {}, { timeoutMs = 25000 } = {}) {
    if (this.closed) return Promise.reject(new Error('probe closed'))
    return new Promise((resolve, reject) => {
      const id = ++this._id
      const timer = setTimeout(() => {
        if (!this._pending.has(id)) return
        this._pending.delete(id)
        reject(new Error(`CDP timeout ${timeoutMs}ms: ${method}`))
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this._pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
        method,
      })
      try { this.ws.send(JSON.stringify({ id, method, params })) } catch (err) { this._pending.delete(id); clearTimeout(timer); reject(err) }
    })
  }

  /** 注入文本（真实输入管线，React/Lexical 状态会更新）。永不抛：
   *  渲染进程忙时 insertText 可能超时，退化为 {ok:false}，让断言如实 FAIL，
   *  而不是把整轮验证台打断（实测在"真实组合"重页面上会偶发）。 */
  async typeText(text, { retries = 1, timeoutMs = 10000 } = {}) {
    let lastErr = null
    for (let i = 0; i <= retries; i += 1) {
      try {
        await this.send('Input.insertText', { text }, { timeoutMs })
        return { ok: true, bytes: text.length, attempts: i + 1 }
      } catch (err) {
        lastErr = err
        await sleep(600)
      }
    }
    return { ok: false, error: String(lastErr?.message ?? lastErr), attempts: retries + 1 }
  }

  /** 建探针：开域 + 装早鸟错误收集器。所有页面加载前调用。 */
  async init() {
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Log.enable').catch(() => {})
    await this.send('Network.enable').catch(() => {})
    // 早鸟：页面脚本可能在任何 Runtime 事件送达前抛错；用注入脚本自留一份权威记录。
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
globalThis.__verifyErrors = globalThis.__verifyErrors || [];
globalThis.addEventListener('error', (e) => {
  try { globalThis.__verifyErrors.push({ kind: 'error', message: String(e.message), source: String(e.filename || ''), line: e.lineno, col: e.colno, stack: e.error && e.error.stack ? String(e.error.stack) : null, at: Date.now() }); } catch {}
}, true);
globalThis.addEventListener('unhandledrejection', (e) => {
  try { const r = e.reason; globalThis.__verifyErrors.push({ kind: 'unhandledrejection', message: r && r.message ? String(r.message) : String(r), stack: r && r.stack ? String(r.stack) : null, at: Date.now() }); } catch {}
}, true);
`,
    })
    return this
  }

  /** 视口 + 触屏模拟。 */
  async setViewport(vp) {
    const v = typeof vp === 'string' ? viewportOf(vp) : vp
    this.viewport = v
    this.touchMode = Boolean(v.touch)
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: v.width,
      height: v.height,
      deviceScaleFactor: v.deviceScaleFactor ?? 1,
      mobile: Boolean(v.mobile),
      screenOrientation: { type: 'portraitPrimary', angle: 0 },
    })
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: Boolean(v.touch), maxTouchPoints: v.touch ? 5 : 1 })
    return v
  }

  /** 真实指针点击：触屏视口发 touch 事件（pointerdown 的 pointerType=touch，
   *  插件 isCoarsePointer 分支才走），否则发 mouse 事件。
   *  注意：合成 click() 不算用户手势——插件的程序化聚焦抑制器会识别并撤焦。 */
  async clickAt(x, y, { tag = '', retries = 1 } = {}) {
    const px = Math.round(x)
    const py = Math.round(y)
    const once = async () => {
      if (this.touchMode) {
        try {
          await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py, radiusX: 12, radiusY: 12, force: 1 }] }, { timeoutMs: 12000 })
          await sleep(60)
          await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, { timeoutMs: 12000 })
        } catch (err) {
          // 输入事件超时不代表页面坏了：清掉可能挂着的触点状态，交给调用方继续。
          try { await this.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }, { timeoutMs: 5000 }) } catch {}
          throw err
        }
      } else {
        await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 }, { timeoutMs: 12000 })
        await sleep(40)
        await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 }, { timeoutMs: 12000 })
      }
    }
    let lastErr = null
    for (let i = 0; i <= retries; i += 1) {
      try { await once(); this.lastClick = { x: px, y: py, touch: this.touchMode, tag, ok: true }; return this.lastClick } catch (err) {
        lastErr = err
        await sleep(600)
      }
    }
    this.lastClick = { x: px, y: py, touch: this.touchMode, tag, ok: false, error: String(lastErr?.message ?? lastErr) }
    return this.lastClick
  }

  /** 元素可见区域中心（矩形与视口求交；不可见返回 null）。 */
  async centerOf(selector, { index = 0 } = {}) {
    const r = await this.evaluate(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els[${index}]; if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      const x0 = Math.max(r.x, 0), x1 = Math.min(r.right, innerWidth);
      const y0 = Math.max(r.y, 0), y1 = Math.min(r.bottom, innerHeight);
      if (x1 - x0 < 4 || y1 - y0 < 4) return null;
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.round(r.width), h: Math.round(r.height), top: y0, bottom: y1 };
    })()`)
    return r.ok ? r.value : null
  }

  /** 点元素（真实指针事件）；返回是否点到。 */
  async clickElement(selector, { index = 0, settleMs = 300 } = {}) {
    const c = await this.centerOf(selector, { index })
    if (c === null) return { ok: false, reason: `not visible: ${selector}[${index}]` }
    await this.clickAt(c.x, c.y, { tag: selector })
    if (settleMs > 0) await sleep(settleMs)
    return { ok: true, at: c }
  }

  /**
   * 关掉上游 dsh 的首次运行/引导模态（Preview Notice / Get started 等）。
   * 这些模态盖住 composer，不清掉行为断言全废；而它们的状态存在**浏览器
   * profile** 里，每次干净 profile 都会重放，所以必须每轮自动过一遍。
   * 安全策略：只点关闭/继续类按钮，绝不点 "Add API Key"/"Sign in" 等会改
   * 环境的按钮；没有安全按钮时停止并如实上报。
   */
  async dismissModals({ max = 8, settleMs = 900 } = {}) {
    const dismissed = []
    for (let i = 0; i < max; i += 1) {
      const found = await this.evaluate(`(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter(d => {
          const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
        if (dialogs.length === 0) return null;
        const d = dialogs[dialogs.length - 1];
        const head = (d.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean).slice(0, 2).join(' / ').slice(0, 90);
        const safe = [...d.querySelectorAll('button')].map(b => {
          const r = b.getBoundingClientRect();
          const label = [b.getAttribute('aria-label'), b.title, b.textContent].filter(Boolean).join(' ').trim();
          return { label: label.slice(0, 40), cls: String(b.className).slice(0, 60), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, tag: b.tagName };
        }).filter(b => b.w > 0 && b.h > 0 && b.x > 0 && b.y > 0 && b.x < innerWidth && b.y < innerHeight);
        const pattern = (b, re) => re.test(b.label) || re.test(b.cls);
        const danger = /add api key|sign in|log ?in|create account|购买|登录|添加/i;
        const closers = /close|dismiss|later|skip|not now|got it|continue|next|ok|done|开始|继续|关闭|稍后|跳过|知道了|完成|下一步/i;
        const pick = safe.find(b => !danger.test(b.label) && /close|dismiss|关闭/i.test(b.label + ' ' + b.cls))
          || safe.find(b => !danger.test(b.label) && closers.test(b.label))
          || safe.find(b => !danger.test(b.label) && /_close_/i.test(b.cls))
          || safe.find(b => !danger.test(b.label) && b.label === '')
          || null;
        return { head, pick, buttons: safe.map(b => b.label) };
      })()`)
      if (!found.ok || found.value === null) break
      const { head, pick, buttons } = found.value
      if (pick === null) {
        dismissed.push({ head, action: 'no-safe-button', buttons })
        break
      }
      await this.clickAt(pick.x, pick.y, { tag: 'modal-dismiss' })
      dismissed.push({ head, action: `clicked "${pick.label}"`, buttons })
      await sleep(settleMs)
    }
    const remaining = await this.evaluate(`document.querySelectorAll('[role="dialog"][aria-modal="true"]').length`)
    return { dismissed, remaining: remaining.value ?? null, cleared: (remaining.value ?? 1) === 0 }
  }

  /**
   * 鉴权并进入应用：先 GET 带 token 的 URL（303 + Set-Cookie），再进根路径。
   * 返回 { tokenGoto, appGoto }。
   */
  async authAndGoto(base, token, { settleMs = 3500, appPath = '/' } = {}) {
    const tokenUrl = `${base}/?token=${encodeURIComponent(token)}`
    await this.navigate(tokenUrl, { settleMs: 400 })
    const afterAuth = await this.evaluate('location.href')
    await this.navigate(`${base}${appPath}`, { settleMs })
    return { tokenUrl, afterAuth }
  }

  async navigate(url, { settleMs = 3000, timeout = 30000 } = {}) {
    const done = new Promise((resolve) => {
      const off = this.on('Page.loadEventFired', () => { off(); resolve('load') })
      setTimeout(() => { off(); resolve('timeout') }, timeout)
    })
    await this.send('Page.navigate', { url })
    await done
    if (settleMs > 0) await sleep(settleMs)
    return url
  }

  /** Runtime.evaluate 包装：永不抛，返回 { ok, value, error, exception }。 */
  async evaluate(expression, { awaitPromise = true, returnByValue = true, timeout = 30000 } = {}) {
    try {
      const res = await this.send('Runtime.evaluate', {
        expression, awaitPromise, returnByValue, timeout,
        userGesture: true, includeCommandLineAPI: true,
      })
      if (res.exceptionDetails) {
        return { ok: false, error: res.exceptionDetails.exception?.description ?? res.exceptionDetails.text, value: undefined }
      }
      // 防呆：表达式求值成函数（漏写 IIFE 的 `()`）时 returnByValue 会静默给 {}，
      // 让断言拿到"空对象"而不是报错——这里显式报错。
      if (res.result?.type === 'function') {
        return { ok: false, error: 'expression 求值结果是 function（十有八九漏了结尾的 () 调用）', value: undefined }
      }
      return { ok: true, value: res.result?.value, error: null }
    } catch (err) {
      return { ok: false, error: String(err?.message ?? err), value: undefined }
    }
  }

  /** 轮询表达式直到为真值；返回 { ok, value, waitedMs, lastError }。 */
  async waitFor(expression, { timeout = 15000, interval = 200, label = expression } = {}) {
    const t0 = Date.now()
    let last
    while (Date.now() - t0 < timeout) {
      last = await this.evaluate(`(() => { try { return (${expression}); } catch (e) { return { __err: String(e && e.message || e) }; } })()`)
      if (last.ok && last.value && !(last.value && last.value.__err)) {
        return { ok: true, value: last.value, waitedMs: Date.now() - t0, label }
      }
      await sleep(interval)
    }
    return { ok: false, value: last?.value, waitedMs: Date.now() - t0, label, lastError: last?.error ?? last?.value?.__err ?? 'timeout' }
  }

  async waitForSelector(selector, { timeout = 15000, interval = 200 } = {}) {
    const r = await this.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, { timeout, interval, label: selector })
    return r
  }

  /** 页面内收集到的错误（早鸟 + CDP 两个来源，已去重）。 */
  async errors() {
    const injected = await this.evaluate('JSON.stringify(globalThis.__verifyErrors || [])')
    let early = []
    if (injected.ok && typeof injected.value === 'string') {
      try { early = JSON.parse(injected.value) } catch { early = [] }
    }
    const cdp = this.pageErrors.map((e) => {
      const d = e.params?.exceptionDetails ?? {}
      return {
        kind: 'exceptionThrown',
        message: d.exception?.description ?? d.text ?? 'unknown',
        source: d.url ?? '',
        line: d.lineNumber,
        col: d.columnNumber,
        stack: d.stackTrace?.callFrames?.slice(0, 6).map((f) => `${f.functionName || '(anon)'} @ ${f.url}:${f.lineNumber}:${f.columnNumber}`).join('\n') ?? null,
        at: e.at,
      }
    })
    const seen = new Set()
    const all = []
    for (const e of [...early, ...cdp]) {
      const key = `${e.kind}|${e.message}|${e.line ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      all.push(e)
    }
    return all
  }

  /** 失败请求（loadingFailed）：把 requestId 映射回 URL，并附带错误文本。 */
  failedRequests() {
    const urlById = new Map(this.requests.map((r) => [r.url, r.url]))
    const byId = new Map()
    for (const r of this.requests) if (r.requestId) byId.set(r.requestId, r.url)
    return this.requestFailed.map((e) => ({
      url: byId.get(e.params?.requestId) ?? e.params?.requestId ?? '',
      error: e.params?.errorText,
      type: e.params?.type,
      canceled: Boolean(e.params?.canceled),
    }))
  }

  /** 按 URL 子串统计请求数（轮询证明用）。 */
  countRequests(substr, { since = 0 } = {}) {
    return this.requests.filter((r) => r.at >= since && String(r.url ?? '').includes(substr)).length
  }

  mark() { return Date.now() }

  /** 清空事件收集（跨"移动轮→桌面轮"复用同一浏览器时用；页面会重载，
   *  __verifyErrors 早鸟数组随之重建）。 */
  resetEvents() {
    this.events = []
    this.consoleEvents = []
    this.pageErrors = []
    this.logEntries = []
    this.requestFailed = []
    this.httpErrors = []
    this.requests = []
  }

  async screenshot(absPath, { fullPage = false } = {}) {
    const params = { format: 'png', captureBeyondViewport: Boolean(fullPage) }
    const res = await this.send('Page.captureScreenshot', params)
    mkdirSync(dirname(absPath), { recursive: true })
    writeFileSync(absPath, Buffer.from(res.data, 'base64'))
    return absPath
  }

  async close({ killBrowser = false } = {}) {
    if (killBrowser) {
      // 优先让浏览器自己退出（干净），失败再杀进程组——头less chromium 会派生子进程，
      // 只 kill 父进程会留下孤儿占住调试端口和内存（实测踩过）。
      try { await Promise.race([this.send('Browser.close'), sleep(1500)]) } catch {}
    }
    try { this.ws.close() } catch {}
    this.closed = true
    if (killBrowser && this.proc) {
      const pid = this.proc.pid
      await sleep(300)
      killGroup(this.proc)
      liveBrowsers.delete(this.proc)
      if (this.userDataDir) {
        try { rmSync(this.userDataDir, { recursive: true, force: true }) } catch {}
      }
    }
  }
}

/** 起干净 chromium 并返回已 init 的 Probe（默认 about:blank）。 */
export async function launchChromium({
  port = null,
  viewport = 'mobile',
  headless = true,
  extraArgs = [],
  keep = false,
  startPort = 9333,
} = {}) {
  const dbgPort = port ?? (await pickPort(startPort))
  const userDataDir = mkdtempSync(join(tmpdir(), 'meow-verify-chrome-'))
  const args = [
    ...(headless ? ['--headless=new'] : []),
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    // 内存预算（cgroup 4GB、无 swap、同机还有 live GUI）：给渲染进程设 V8 上限
    // 并限制渲染进程数，避免被内核 global OOM 杀（实测踩过）。
    '--js-flags=--max-old-space-size=256',
    '--renderer-process-limit=2',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    `--remote-debugging-port=${dbgPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=390,844',
    'about:blank',
    ...extraArgs,
  ]
  const proc = spawn(CHROMIUM, args, { stdio: 'ignore', detached: true })
  proc.on('error', () => {})
  liveBrowsers.add(proc)
  hookCleanup()
  await waitCdpEndpoint(dbgPort)
  const list = await (await fetch(`http://127.0.0.1:${dbgPort}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target after chromium launch')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error(`ws open failed: ${e?.message ?? 'error'}`)) })
  const probe = new Probe({ ws, port: dbgPort, proc, userDataDir })
  await probe.init()
  await probe.setViewport(viewport)
  probe.keep = keep
  return probe
}

/** 连到已在跑的 chromium（--remote-debugging-port=<port>）。 */
export async function connect(port, { viewport = null, newTabUrl = null } = {}) {
  await waitCdpEndpoint(port)
  let target
  if (newTabUrl !== null) {
    const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(newTabUrl)}`, { method: 'PUT' })
    target = await res.json()
  } else {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((t) => t.type === 'page')
    if (!target) throw new Error(`no page target on port ${port}`)
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error(`ws open failed: ${e?.message ?? 'error'}`)) })
  const probe = new Probe({ ws, port, targetId: target.id })
  await probe.init()
  if (viewport) await probe.setViewport(viewport)
  return probe
}

/* ------------------------------------------------------------------ *
 * CLI                                                                *
 * ------------------------------------------------------------------ */
async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (i >= 0 ? true : dflt)
  }
  const url = arg('url', null)
  const token = arg('token', null)
  const bootLog = arg('boot-log', '/tmp/meowtest-boot.log')
  const viewport = String(arg('viewport', 'mobile'))
  const waitMs = Number(arg('wait', 6000))
  const shot = arg('shot', null)
  const evalJs = arg('eval', null)
  const selectors = arg('selectors', null)
  const dumpDom = Boolean(arg('dump-dom', false))
  if (!url) { console.error('用法见文件头注释；至少需要 --url'); process.exit(2) }

  let base = String(url).replace(/\/$/, '')
  let tok = token
  if (tok === true || tok == null) {
    try { tok = readBootUrl(bootLog).token } catch { tok = null }
  }
  const probe = await launchChromium({ viewport })
  try {
    if (tok) await probe.authAndGoto(base, String(tok), { settleMs: waitMs })
    else await probe.navigate(base, { settleMs: waitMs })

    const out = {}
    if (evalJs) {
      const r = await probe.evaluate(String(evalJs))
      out.eval = r.ok ? r.value : { error: r.error }
    }
    if (selectors) {
      const list = String(selectors).split(',').map((s) => s.trim()).filter(Boolean)
      out.selectors = Object.fromEntries(list.map((s) => [s, undefined]))
      const r = await probe.evaluate(`(() => {
        const out = {};
        for (const s of ${JSON.stringify(list)}) out[s] = !!document.querySelector(s);
        return out;
      })()`)
      out.selectors = r.value
    }
    if (dumpDom) {
      const r = await probe.evaluate(`(() => {
        const attrs = (el) => el ? [...el.attributes].map(a => a.name).filter(n => n.startsWith('data-')) : null;
        const card = document.querySelector('[data-composer-card]');
        return {
          href: location.href,
          title: document.title,
          html: attrs(document.documentElement),
          body: attrs(document.body),
          composerCard: attrs(card),
          styles: [...document.querySelectorAll('style[data-meow-fold-css], style[data-meow-smooth-settings-css], style[data-meow-smooth-gesture-css]')].map(s => s.getAttribute('data-meow-fold-css') !== null ? 'fold-css' : (s.getAttribute('data-meow-smooth-settings-css') !== null ? 'settings-css' : 'gesture-css')),
          meowNodes: [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(a => a.name.startsWith('data-meow'))).length,
        };
      })()`)
      out.dom = r.value
    }
    out.errors = await probe.errors()
    out.httpErrors = probe.httpErrors.slice(0, 20)
    if (shot) await probe.screenshot(String(shot))
    console.log(JSON.stringify(out, null, 2))
  } finally {
    await probe.close({ killBrowser: true })
  }
  process.exit(0)
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) main().catch((err) => { console.error('FATAL', err); process.exit(1) })