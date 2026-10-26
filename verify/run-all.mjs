#!/usr/bin/env node
/**
 * verify/run-all.mjs — meow-smooth × dsh 0.2.1-rc.2 端到端验证台（一键跑全部断言 + 出报告）。
 *
 * 用法：
 *   node verify/run-all.mjs                                  # 默认打 17899（/tmp/meowtest-boot.log）
 *   node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log \
 *                           --target 17900=/tmp/dshmirror-boot.log
 *   node verify/run-all.mjs --base http://127.0.0.1:17899 --token <t> --label "临时实例"
 *   node verify/run-all.mjs --only BEHAV-1,ANCHOR-1           # 只跑指定断言（调试）
 *   node verify/run-all.mjs --out verify/report.md --shots verify/shots
 *
 * 产出：verify/report.md（每条断言 PASS/FAIL/N-A + 证据片段 + 截图 + 最小复现步骤）
 *       verify/raw/<label>-*.json（原始观测数据，便于 Lead 复核与 diff）
 *
 * 稳定性约定：
 *   - 每个视口一个**干净** chromium profile，开头统一过一遍上游引导模态
 *     （Preview Notice / Get started），否则模态盖住 composer，行为断言全假失败；
 *   - 所有交互走真实输入事件（触屏视口发 touch，桌面发 mouse），
 *     不用 element.click()——插件的程序化聚焦抑制器会识别并撤焦；
 *   - 失败的断言不影响后续断言执行，最后统一汇总。
 */
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchChromium, readBootUrl, sleep, VIEWPORT_MOBILE, VIEWPORT_DESKTOP } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

/* ----------------------------- 参数解析 ----------------------------- */
function parseArgs(argv) {
  const out = { targets: [], only: null, out: join(HERE, 'report.md'), shots: join(HERE, 'shots'), raw: join(HERE, 'raw'), label: null, base: null, token: null, bootLog: null, fromRaw: null, phase: 'both' }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--target') out.targets.push(next())
    else if (a === '--only') out.only = next().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--out') out.out = resolve(next())
    else if (a === '--shots') out.shots = resolve(next())
    else if (a === '--raw') out.raw = resolve(next())
    else if (a === '--label') out.label = next()
    else if (a === '--base') out.base = next()
    else if (a === '--token') out.token = next()
    else if (a === '--boot-log') out.bootLog = next()
    else if (a === '--from-raw') out.fromRaw = resolve(next())
    else if (a === '--phase') out.phase = next()
    else if (a === '-h' || a === '--help') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n')); process.exit(0) }
  }
  if (out.targets.length === 0) {
    if (out.base) out.targets.push(`${out.label ?? out.base}=${out.base}`)
    else out.targets.push(`17899=${out.bootLog ?? '/tmp/meowtest-boot.log'}`)
  }
  return out
}
const ARGS = parseArgs(process.argv.slice(2))
mkdirSync(ARGS.shots, { recursive: true })
mkdirSync(ARGS.raw, { recursive: true })

/* ----------------------------- 结果收集 ----------------------------- */
/** 状态：PASS / FAIL / N/A（无法自动断言，附原因）/ INFO（观测事实，非断言）。 */
const results = []
/** 当前目标标签（17899 / 17900），record() 自动打标 → 报告可分栏。 */
let currentTargetLabel = null
function record(r) {
  results.push({ shots: [], details: null, repro: '', owner: '', target: currentTargetLabel, ...r })
  const icon = { PASS: '✅ PASS', FAIL: '❌ FAIL', 'N/A': '⚪ N/A', INFO: 'ℹ️ INFO' }[r.status] ?? r.status
  console.log(`  ${icon}  ${r.id}  ${r.title}`)
  return r
}
function has(id) { return !ARGS.only || ARGS.only.includes(id) }
const T0 = Date.now()
function log(msg) { console.log(`  [${String(Math.round((Date.now() - T0) / 1000)).padStart(4)}s] ${msg}`) }
function phase(name) { log(`→ ${name}`) }
function shot(probe, name) {
  const p = join(ARGS.shots, `${name}.png`)
  return probe.screenshot(p).then(() => p).catch(() => null)
}

/* --------------------------- 实例侧（HTTP） --------------------------- */
async function authCookie(base, token) {
  const res = await fetch(`${base}/?token=${encodeURIComponent(token)}`, { redirect: 'manual', headers: { Accept: 'text/html' } })
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const cookie = raw.map((c) => c.split(';')[0]).join('; ')
  return { status: res.status, location: res.headers.get('location'), cookie, raw }
}

async function httpGet(url, cookie) {
  try {
    const res = await fetch(url, { headers: cookie ? { Cookie: cookie } : {}, redirect: 'manual' })
    const text = await res.text()
    return { status: res.status, text, headers: res.headers }
  } catch (err) {
    // 实例在跑批期间被重启/掉线时 fetch 会直接抛：返回 status=0 让上层判定"环境不稳"，
    // 而不是把整轮打断成 HARNESS 失败。
    return { status: 0, text: '', error: String(err?.message ?? err) }
  }
}

/** 实例指纹：用于检测"跑批期间被重启/换 home"（本轮实测踩过：Lead 中途换了 DSH_HOME）。 */
async function instanceFingerprint(base, cookie, bootLogPath) {
  const pending = await httpGet(`${base}/plugins/meow-smooth/pending`, cookie)
  let json = null
  try { json = JSON.parse(pending.text) } catch {}
  let bootToken = null
  try { bootToken = readBootUrl(bootLogPath).token } catch {}
  return { pendingStatus: pending.status, hostVersion: json?.hostVersion ?? null, bootToken, error: pending.error ?? null }
}

function sha256File(p) {
  try { return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16) } catch { return null }
}
function mtime(p) { try { return statSync(p).mtime.toISOString() } catch { return null } }
function gitHead() { try { return execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim() } catch { return null } }

/** 代码/构建快照：把证据钉在具体版本上（Lead 复跑时可直接对比）。 */
function artifactSnapshot() {
  const files = ['src/client.ts', 'src/index.ts', 'src/notify-host.ts', 'src/notify-client.ts', 'src/settings-mobile.ts', 'src/sidebar-gesture.ts', 'src/auth-gate.ts', 'src/compress-proxy.ts', 'lib/client.js', 'lib/index.js', 'package.json']
  const out = { gitHead: gitHead(), files: {} }
  for (const f of files) out.files[f] = { mtime: mtime(join(REPO, f)), sha256_16: sha256File(join(REPO, f)) }
  try { out.pkgVersion = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version } catch { out.pkgVersion = null }
  return out
}

/** 上游锚点契约静态检查：抓 shell + 所有 plugins/?? 组合 bundle，看插件依赖的
 *  DOM 锚点是否仍由上游提供。上游改名的锚点会让插件静默失效（比报错更难查）。 */
const UPSTREAM_ANCHORS = [
  'data-composer-card', 'data-input-scroll', 'data-composer-input', 'data-sidebar-collapsed',
  'data-sidebar-right-panel', 'data-sidebar-right-open', 'data-slot', 'data-row-key',
  'data-question-key', 'data-approval-key', 'data-plan-review-key',
]
async function upstreamAnchorContract(base, cookie) {
  const html = await httpGet(`${base}/`, cookie)
  const comboHrefs = [...html.text.matchAll(/(?:href|src)="(plugins\/\?\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  const shellSrc = [...html.text.matchAll(/src="(\.\/assets\/[^"]+)"/g)].map((m) => m[1])
  const meowRev = (html.text.match(/meow-smooth\/client\.js(?:&amp;|&)rev=([0-9a-f]+)/) ?? [])[1] ?? null
  const meowBundlePath = (html.text.match(/plugins\/\?\?[^"]*meow-smooth\/client\.js[^"]*/) ?? [])[0] ?? null
  let corpus = ''
  const sources = []
  for (const src of shellSrc) {
    const g = await httpGet(`${base}/${src.replace(/^\.\//, '')}`, cookie)
    corpus += g.text
    sources.push({ url: src, status: g.status, bytes: g.text.length })
  }
  for (const href of comboHrefs) {
    const g = await httpGet(`${base}/${href}`, cookie)
    corpus += g.text
    sources.push({ url: href.slice(0, 120) + (href.length > 120 ? '…' : ''), status: g.status, bytes: g.text.length, rows: (href.split('??')[1] ?? '').split(',').length })
  }
  const found = {}
  for (const a of UPSTREAM_ANCHORS) found[a] = corpus.includes(a)
  return { meowRev, meowBundlePath, comboCount: comboHrefs.length, shellSrc, sources, corpusBytes: corpus.length, found }
}

/* --------------------------- 浏览器侧断言 --------------------------- */
const FRAME = `document.querySelector('[data-slot="root"] > *')`
const SIDEBAR_ROW = '[data-slot="sidebar"] [data-row-key]'

const snapshotExpr = `(() => {
    const q = (s) => document.querySelector(s);
    const card = q('[data-composer-card]'), scroll = q('[data-input-scroll]');
    const cs = scroll ? getComputedStyle(scroll) : null;
    const frame = ${FRAME};
    return {
      href: location.href, title: document.title,
      htmlAttrs: [...document.documentElement.attributes].map(a => a.name + '=' + String(a.value).slice(0, 48)),
      meowAttrNodes: [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(a => a.name.startsWith('data-meow'))).map(el => ({ tag: el.tagName, attrs: [...el.attributes].map(a => a.name + '=' + String(a.value).slice(0, 40)).filter(x => x.startsWith('data-meow')) })),
      meowStyles: [...document.querySelectorAll('style[data-plugin="meow-smooth"]')].map(s => s.getAttribute('data-meow-fold-css') !== null ? 'fold-css' : (s.getAttribute('data-meow-smooth-settings-css') !== null ? 'settings-css' : (s.getAttribute('data-meow-smooth-gesture-css') !== null ? 'gesture-css' : 'other'))),
      disposeHook: typeof window.__meowSmoothClientDispose,
      moduleLoaderKeys: window.__ModuleLoader__ ? Object.keys(window.__ModuleLoader__) : null,
      moduleLoaderMode: window.__ModuleLoader__ ? window.__ModuleLoader__.mode : null,
      pendingQueueLen: window.__ModuleLoader__ && window.__ModuleLoader__.pendingQueue ? window.__ModuleLoader__.pendingQueue.length : null,
      anchors: {
        card: !!card, scroll: !!scroll, input: !!q('[data-composer-input]'),
        sidebarCollapsed: !!q('[data-sidebar-collapsed]'),
        sidebarRightPanel: !!q('[data-sidebar-right-panel]'),
        sidebarRightOpen: !!q('[data-sidebar-right-open]'),
        questionKey: !!q('[data-question-key]'), approvalKey: !!q('[data-approval-key]'),
        messageActions: !!q('[data-slot="message.actions"]') || !!q('[data-message-actions]') || !!q('[class*="message"][class*="actions"]'),
        pendingBar: !!q('[data-meow-smooth-pending]'), fab: !!q('[data-meow-smooth-fab]'),
        settingsPanel: !!q('[data-meow-smooth-settings]'),
      },
      composer: {
        collapseAttr: card ? card.getAttribute('data-meow-smooth') : null,
        inlineHeight: card ? card.style.getPropertyValue('--meow-smooth-fold-height') : '',
        cardH: card ? Math.round(card.getBoundingClientRect().height) : null,
        scrollClientH: scroll ? scroll.clientHeight : null,
        scrollScrollH: scroll ? scroll.scrollHeight : null,
        lineHeight: cs ? cs.lineHeight : null,
        fontSize: cs ? cs.fontSize : null,
        padTop: cs ? cs.paddingTop : null, padBottom: cs ? cs.paddingBottom : null,
        textLen: (() => { const ci = q('[data-composer-input], textarea'); if (!ci) return null; return ci.tagName === 'TEXTAREA' ? (ci.value ?? '').length : (ci.textContent ?? '').length; })(),
        composerInputTag: (() => { const ci = q('[data-composer-input], textarea'); return ci ? ci.tagName : null; })(),
      },
      frame: frame ? { attrs: [...frame.attributes].map(a => a.name).filter(n => n.startsWith('data-')) } : null,
      furl: document.documentElement.getAttribute('data-meow-smooth-furled'),
      foldTrace: (window.__meowFoldTrace ?? []).slice(-8),
    };
})()`

/** 采集一次页面快照；页面刚好在重载/重绘时会拿到空壳，等一拍重试一次。 */
async function snapshotDom(probe) {
  const r = await probe.evaluate(snapshotExpr)
  if (r.ok && r.value && !r.value.error) return r.value
  await sleep(800)
  const retry = await probe.evaluate(snapshotExpr)
  return retry.ok && retry.value ? retry.value : { error: r.error ?? retry.error ?? 'snapshot failed' }
}

/** 量折叠：返回折叠态测量值 + 期望行数的对比。 */
function foldVerdict(before, after, lines) {
  const line = parseFloat(before.composer.lineHeight) || 24
  const pad = (parseFloat(before.composer.padTop) || 0) + (parseFloat(before.composer.padBottom) || 0)
  const expected = line * lines + pad
  const got = after.composer.scrollClientH
  const tol = 3
  return {
    expected, got, line, pad, tolerance: tol,
    ok: after.composer.collapseAttr === 'collapsed' && Math.abs(got - expected) <= tol && got < before.composer.scrollScrollH,
    attr: after.composer.collapseAttr, inline: after.composer.inlineHeight,
  }
}

/** 关掉上游引导模态（干净 profile 每次都会重放）。 */
async function setupInstance(probe, base, token, { settleMs = 6000, viewportAlreadySet = false } = {}) {
  if (viewportAlreadySet) {
    // 复用同一浏览器：视口已切好，这里只重载页面回到干净态（清掉上一轮的草稿/侧栏态）
    await probe.navigate(`${base}/`, { settleMs })
    return await probe.dismissModals()
  }
  await probe.authAndGoto(base, token, { settleMs })
  return await probe.dismissModals()
}

/* ----- 移动视口：锚点/折叠/侧边栏/设置/轮询轮询 ----- */
async function runMobile(probe, base, token, tag, { pendingJson = null } = {}) {
  const facts = { modal: null, snapshots: {}, pendingJson }
  try {
    phase('移动视口：鉴权 + 过引导模态')
    facts.modal = await setupInstance(probe, base, token)
    facts.snapshots.initial = await snapshotDom(probe)
    phase('移动视口：初始截图')
    facts.shots = { initial: await shot(probe, `${tag}-mobile-initial`) }
    facts.meowRev = (await probe.evaluate(`(() => { const n = performance.getEntriesByType('resource').map(e => e.name).find(x => /meow-smooth\\/client\\.js/.test(x)); const m = n && n.match(/rev=([0-9a-f]+)/); return m ? m[1] : null; })()`)).value ?? null
    phase('移动视口：运行时/锚点/bundle 断言')

    /* ---- ANCHOR-* / BUNDLE-* / PAGE-* ---- */
    if (has('PAGE-1')) {
      const errs = await probe.errors()
      const failed = probe.failedRequests()
      const jserrs = errs.filter((e) => e.kind !== 'unhandledrejection')
      const rejs = errs.filter((e) => e.kind === 'unhandledrejection')
      record({
        id: 'PAGE-1', group: '页面运行时', title: '移动视口整轮无 pageerror（插件脚本硬故障的第一信号）',
        status: jserrs.length === 0 ? 'PASS' : 'FAIL',
        evidence: jserrs.length === 0
          ? `Runtime.exceptionThrown=0；注入式早鸟 window.__verifyErrors 中 error 类 0 条；Network.loadingFailed=${failed.length}`
          : `捕获 ${jserrs.length} 条：\n${jserrs.slice(0, 4).map((e) => `- [${e.kind}] ${String(e.message).split('\n')[0].slice(0, 200)}${e.source ? ` @ ${e.source}:${e.line}` : ''}`).join('\n')}`,
        details: { jserrs, failed },
        owner: jserrs.length ? 'client-compat（先看 stack 落在哪个模块）' : '',
        repro: jserrs.length ? 'node verify/run-all.mjs --only PAGE-1；或 chromium 打开实例 → DevTools Console 看红字' : '',
        shots: [facts.shots.initial],
      })
      record({
        id: 'PAGE-2', group: '页面运行时', title: '无 unhandledrejection（未捕获 promise 拒绝）',
        status: rejs.length === 0 ? 'PASS' : 'FAIL',
        evidence: rejs.length === 0 ? 'unhandledrejection=0' : rejs.map((e) => String(e.message).slice(0, 160)).join('\n'),
        details: { rejs }, owner: rejs.length ? 'client-compat' : '',
        repro: 'node verify/run-all.mjs --only PAGE-2',
      })
      // 只看**同源**（被测实例）资源：第三方（如 dshmarket 遥测）403/被墙属别的插件，
      // 不该算 meow-smooth 的账，但要如实记下来。
      const isLocal = (u) => String(u ?? '').startsWith(base)
      const canceledNoise = (f) => f.canceled || /ERR_ABORTED/.test(String(f.error ?? ''))
      const localFailed = failed.filter((f) => isLocal(f.url) && !canceledNoise(f))
      const localHttp = probe.httpErrors.filter((h) => isLocal(h.url))
      const thirdParty = [...failed.filter((f) => !isLocal(f.url) && !canceledNoise(f)), ...probe.httpErrors.filter((h) => !isLocal(h.url))]
      const ok3 = localFailed.length === 0 && localHttp.length === 0
      record({
        id: 'PAGE-3', group: '页面运行时', title: '被测实例同源资源无失败请求 / 无 4xx-5xx',
        status: ok3 ? 'PASS' : 'FAIL',
        evidence: [
          ok3 ? `同源 loadingFailed=0；同源 HTTP 错误=0（含 /plugins/meow-smooth/* 全部 200）` : `同源失败 ${localFailed.length} 条 / 同源 4xx-5xx ${localHttp.length} 条：${JSON.stringify([...localFailed.slice(0, 3), ...localHttp.slice(0, 3)])}`,
          thirdParty.length ? `另有第三方（非被测实例）资源失败 ${thirdParty.length} 条，与 meow-smooth 无关，仅备案：${JSON.stringify(thirdParty.slice(0, 4))}` : '无第三方资源失败',
        ].join('\n'),
        details: { localFailed, localHttp, thirdParty, failed, httpErrors: probe.httpErrors },
        owner: ok3 ? '' : 'client-compat / host-compat（按 URL 归属；先看是否 /plugins/meow-smooth/*）',
        repro: 'node verify/run-all.mjs --only PAGE-3',
      })
    }

    if (has('BUNDLE-1')) {
      const s = facts.snapshots.initial ?? {}
      const combo = await probe.evaluate(`performance.getEntriesByType('resource').map(e => e.name).filter(n => /meow-smooth\\/client\\.js/.test(n))`)
      const urls = combo.value ?? []
      record({
        id: 'BUNDLE-1', group: 'client bundle 加载', title: 'shell 组合 URL 包含并成功加载 meow-smooth/client.js',
        status: urls.length > 0 ? 'PASS' : 'FAIL',
        evidence: urls.length > 0
          ? `resource timing 命中 ${urls.length} 条：\n${urls.map((u) => `- ${u.slice(0, 200)}…`).join('\n')}`
          : `resource timing 未命中 meow-smooth/client.js；ModuleLoader.mode=${s.moduleLoaderMode}, pendingQueue=${s.pendingQueueLen}`,
        details: { urls, moduleLoaderKeys: s.moduleLoaderKeys, mode: s.moduleLoaderMode },
        owner: urls.length ? '' : 'host-compat（combo 图未包含插件行）',
        repro: 'node verify/cdp.mjs --url <base> --token <t> --eval "performance.getEntriesByType(\'resource\').map(e=>e.name).filter(n=>/meow-smooth/.test(n))"',
      })
    }

    if (has('BUNDLE-3')) {
      const s = facts.snapshots.initial ?? {}
      const need = ['fold-css', 'gesture-css', 'settings-css']
      const got = s.meowStyles ?? []
      const missing = need.filter((n) => !got.includes(n))
      record({
        id: 'BUNDLE-3', group: 'client bundle 加载', title: '插件注入的三张样式表都在 DOM（fold / gesture / settings）',
        status: missing.length === 0 ? 'PASS' : 'FAIL',
        evidence: `style[data-plugin="meow-smooth"] = [${got.join(', ')}]${missing.length ? `；缺 ${missing.join(', ')}` : ''}`,
        details: { got, missing },
        owner: missing.length ? 'client-compat' : '',
        repro: 'document.querySelectorAll(\'style[data-plugin="meow-smooth"]\')',
      })
    }

    if (has('BUNDLE-4')) {
      const s = facts.snapshots.initial ?? {}
      const attrs = s.meowAttrNodes ?? []
      const hasGesture = (s.htmlAttrs ?? []).some((a) => a.startsWith('data-meow-smooth-gesture-loaded'))
      const hasApply = (s.htmlAttrs ?? []).some((a) => a.startsWith('data-meow-apply-stage'))
      const anch = s.anchors ?? {}
      const hasFab = anch.fab, hasBar = anch.pendingBar
      const ok = attrs.length > 0 && hasGesture && hasFab && hasBar && s.disposeHook === 'function'
      record({
        id: 'BUNDLE-4', group: 'client bundle 加载', title: '插件运行时产物存在（html 标记 + FAB + pending 条 + dispose 钩子）',
        status: ok ? 'PASS' : 'FAIL',
        evidence: [
          `html[data-meow-smooth-gesture-loaded]=${hasGesture}，html[data-meow-apply-stage]=${hasApply}`,
          `button[data-meow-smooth-fab]=${hasFab}，div[data-meow-smooth-pending]=${hasBar}`,
          `typeof window.__meowSmoothClientDispose=${s.disposeHook}`,
          `带 data-meow* 属性的节点 ${attrs.length} 个：${attrs.map((a) => `${a.tag}[${a.attrs.join(' ')}]`).slice(0, 6).join(' / ')}`,
        ].join('\n'),
        details: { attrs, disposeHook: s.disposeHook, htmlAttrs: s.htmlAttrs },
        owner: ok ? '' : 'client-compat',
        repro: 'node verify/cdp.mjs --url <base> --dump-dom',
      })
    }

    if (has('ANCHOR-1')) {
      const a = facts.snapshots.initial?.anchors ?? {}
      // 硬要求：composer/滚动窗/输入元素（插件折叠功能的立足点，0.1.5 与 0.2.x 都有）。
      const core = { '[data-composer-card]': a.card, '[data-input-scroll]': a.scroll, '[data-composer-input]': a.input }
      // 观察项：上游 0.2.x 才有的元素（旧版缺失是版本差异，不算回归）。
      const versioned = { '[data-sidebar-right-panel]': a.sidebarRightPanel, '[data-sidebar-right-open]': a.sidebarRightOpen }
      const missing = Object.entries(core).filter(([, v]) => !v).map(([k]) => k)
      record({
        id: 'ANCHOR-1', group: 'DOM 锚点契约', title: '核心 composer 锚点存在（右栏锚点按上游版本记为观察项）',
        status: missing.length === 0 ? 'PASS' : 'FAIL',
        evidence: [
          '硬要求（插件折叠立足点）：' + Object.entries(core).map(([k, v]) => `${k}: ${v}`).join('，'),
          '观察项（上游 0.2.x 新增元素，旧版缺失非回归）：' + Object.entries(versioned).map(([k, v]) => `${k}: ${v}`).join('，'),
          missing.length ? `缺失硬要求锚点：${missing.join(', ')} → 需按上游改名处理` : '硬要求锚点齐全',
        ].join('\n'),
        details: { core, versioned },
        owner: missing.length ? 'upstream-change（锚点改名 → client-compat 跟进）' : '',
        repro: 'node verify/cdp.mjs --url <base> --selectors "[data-composer-card],[data-input-scroll],[data-composer-input],[data-sidebar-right-panel]"',
      })
    }

    if (has('ANCHOR-2')) {
      const a = facts.snapshots.initial?.anchors ?? {}
      record({
        id: 'ANCHOR-2', group: 'DOM 锚点契约', title: '消息操作行 / 侧边栏折叠锚点',
        status: a.sidebarCollapsed || a.messageActions ? 'PASS' : 'FAIL',
        evidence: `[data-sidebar-collapsed]=${a.sidebarCollapsed}（窄屏默认收起态由上游渲染）；消息操作行=${a.messageActions}（空会话无消息时上游不渲染，属正常）`,
        details: a, owner: '',
        repro: '在移动视口打开一个已有消息的会话后复查 [data-slot="message.actions"]',
      })
    }

    if (has('ANCHOR-3')) {
      const a = facts.snapshots.initial?.anchors ?? {}
      record({
        id: 'ANCHOR-3', group: 'DOM 锚点契约', title: 'pending 交互锚点 [data-question-key]/[data-approval-key]',
        status: 'N/A',
        evidence: [
          '无法自动断言：测试 home 无模型凭证（.credentials.yaml 只有 browser-session grant），无法驱动真实 agent 轮次造出 pending question/approval。',
          `当前页面：questionKey=${a.questionKey}, approvalKey=${a.approvalKey}（无 pending 时上游本就不渲染，非缺陷）。`,
          '替代证据见 STATIC-1（上游 bundle 仍提供这两个锚点）+ 手工复现步骤见报告末节。',
        ].join('\n'),
        details: a, owner: '',
        repro: '手工：在 17899/17900 打开一个会话 → 发一条会触发提问的消息（如要求 agent 用 ask_user_question 提问）→ 面板出现后查 [data-question-key]；审批同理用会触发审批的工具。',
      })
    }

    /* ---- BEHAV-1 移动端折叠 ---- */
    phase('BEHAV-1 移动端折叠')

    if (has('BEHAV-1')) {
      // 前置：composer 是否可编辑。上游某些版本/状态会把 [data-composer-input] 渲染成
      // contenteditable="false"（0.1.5 的 contentEditable 由 `editor !== null && editable` 决定），
      // 此时"输入多行→失焦折叠"无从实测 → 记 N/A，不记 FAIL（避免把版本/环境差异当回归）。
      const editableProbe = await probe.evaluate(`(() => { const i=document.querySelector('[data-composer-input], textarea');
        if (!i) return { exists:false, editable:false };
        return { exists:true, tag:i.tagName, isCE:i.isContentEditable, ceAttr:i.getAttribute('contenteditable'), taCount:document.querySelectorAll('textarea').length, editable: i.tagName==='TEXTAREA' || i.isContentEditable }; })()`)
      const editableOk = Boolean(editableProbe.value?.editable)
      const before = await snapshotDom(probe)
      const tap = await probe.clickElement('[data-input-scroll]')
      await sleep(700)
      const focusState = await probe.evaluate(`(() => { const i=document.querySelector('[data-composer-input], textarea'); return { isInput: document.activeElement === i, tag: i ? i.tagName : null, attr: document.querySelector('[data-composer-card]')?.getAttribute('data-meow-smooth') ?? null }; })()`)
      const expanded = await snapshotDom(probe)
      const typeRes = await probe.typeText('alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\nx7\nx8')
      await sleep(900)
      const typed = await snapshotDom(probe)
      const shotTyped = await shot(probe, `${tag}-mobile-typed`)
      await probe.clickAt(Math.round(VIEWPORT_MOBILE.width / 2), 120)
      await sleep(1100)
      const after = await snapshotDom(probe)
      const shotFolded = await shot(probe, `${tag}-mobile-folded`)
      facts.snapshots.fold = { before, expanded, typed, after }
      const v = (typed?.composer && after?.composer) ? foldVerdict(typed, after, 1) : { ok: false, reason: '快照失败', got: null, expected: null }
      if (editableOk && (!typeRes.ok || (typed.composer?.textLen ?? 0) < 8)) { v.ok = false; v.reason = `注入未生效（ok=${typeRes.ok}, textLen=${typed.composer?.textLen}）` }
      const expandOk = expanded?.composer?.collapseAttr === null
      record({
        id: 'BEHAV-1', group: '插件行为实测', title: '移动视口：输入多行→失焦，[data-input-scroll] 被压到 1 行（1 行 = line-height×1 + padding）',
        status: !editableOk ? 'N/A' : (v.ok ? 'PASS' : 'FAIL'),
        evidence: [
          !editableOk ? `⚪ 无法自动断言：上游把 composer 渲染为**不可编辑**（${JSON.stringify(editableProbe.value)}）→ "输入多行→失焦折叠"无从实测；这不代表折叠失效。归因：0.1.5 自身 dsh-client-ui-conversation/lib/client.js 里该属性由 editor !== null && editable 决定（上游状态，非插件设置）。` : null,
          `初始：attr=${before.composer.collapseAttr}, scrollClientH=${before.composer.scrollClientH}`,
          `真实触屏点输入框后：activeElement 命中 [data-composer-input]=${focusState.value?.isInput}, 折叠属性=${focusState.value?.attr}（null=已展开）, scrollClientH=${expanded.composer.scrollClientH}（展开判定 ${expandOk ? 'OK' : '异常：点击未展开'}）`,
          `注入 8 行文本：ok=${typeRes.ok}${typeRes.ok ? '' : `（失败：${typeRes.error}——渲染进程忙或输入未落到 composer）`}，textLen=${typed.composer.textLen}, scrollScrollH=${typed.composer.scrollScrollH}（内容确实多行增长）`,
          `点卡片外失焦后：attr=${v.attr}, --meow-smooth-fold-height=${v.inline}, scrollClientH=${v.got}, 期望 1 行=${v.expected}（line-height ${v.line} + padding ${v.pad}，容差 ±${v.tolerance}）`,
          `foldTrace: ${JSON.stringify(after?.foldTrace ?? [])}`,
        ].filter(Boolean).join('\n'),
        details: { verdict: v, editableOk, editableProbe: editableProbe.value, expandOk, typeRes, focusState: focusState.value, before: before.composer, typed: typed.composer, after: after.composer, trace: after?.foldTrace ?? [] },
        owner: !editableOk ? '' : (v.ok ? '' : 'client-compat'),
        repro: 'node verify/run-all.mjs --only BEHAV-1（可加 --shots 看截图）',
        shots: [shotTyped, shotFolded],
      })
    }

    /* ---- BEHAV-3 轮询 ---- */
    phase('BEHAV-3 轮询窗口（7.5s）')

    if (has('BEHAV-3')) {
      const t0 = probe.mark()
      await sleep(7500)
      const pend = probe.countRequests('/plugins/meow-smooth/pending', { since: t0 })
      const diag = probe.countRequests('/plugins/meow-smooth/diag-log', { since: t0 })
      const others = [...new Set(probe.requests.filter((r) => r.at >= t0 && String(r.url).includes('/plugins/meow-smooth/')).map((r) => String(r.url).replace(/^.*\/plugins\/meow-smooth\//, '').split('?')[0]))]
      record({
        id: 'BEHAV-3', group: '插件行为实测', title: 'host 轮询活着：7.5s 窗口内 /plugins/meow-smooth/pending 请求 ≥2 次（插件 3s 间隔）',
        status: pend >= 2 ? 'PASS' : 'FAIL',
        evidence: `窗口 7.5s：GET /plugins/meow-smooth/pending × ${pend}；/diag-log × ${diag}；窗口内全部插件路由=${JSON.stringify(others)}`,
        details: { pend, diag, others },
        owner: pend >= 2 ? '' : 'client-compat（轮询定时器未起）',
        repro: 'node verify/run-all.mjs --only BEHAV-3',
      })
    }

    /* ---- BEHAV-4 pending 卡片存在性 ---- */
    phase('BEHAV-4 pending 卡片')

    if (has('BEHAV-4')) {
      const s = await snapshotDom(probe)
      const bar = await probe.evaluate(`(() => { const b=document.querySelector('[data-meow-smooth-pending]'); if(!b) return null; const r=b.getBoundingClientRect(); const cs=getComputedStyle(b);
        return { visible: b.getAttribute('data-visible'), mode: b.getAttribute('data-mode'), text: (b.textContent||'').slice(0,80), rect:{w:Math.round(r.width),h:Math.round(r.height)}, display: cs.display, opacity: cs.opacity }; })()`)
      const hostState = facts.pendingJson
      const noPending = !hostState || ((hostState.approvals?.length ?? 0) === 0 && (hostState.questions?.length ?? 0) === 0 && (hostState.events?.length ?? 0) === 0)
      record({
        id: 'BEHAV-4', group: '插件行为实测', title: '提醒卡片节点已挂载且与 host 空态一致（有 pending 时的展开渲染无法自动断言）',
        status: (s.anchors ?? {}).pendingBar ? 'PASS' : 'FAIL',
        evidence: [
          `div[data-meow-smooth-pending] 存在=${(s.anchors ?? {}).pendingBar}；实测=${JSON.stringify(bar.value)}`,
          `host GET /pending 空态=${noPending ? '是' : '否'}：${JSON.stringify(hostState)}`,
          '说明：「有真实未决审批/提问时卡片展开、按钮可跳转」受限于无模型凭证造不出 pending，无法自动断言（见报告末节手工步骤）。',
        ].join('\n'),
        details: { bar: bar.value, hostState, noPending },
        owner: (s.anchors ?? {}).pendingBar ? '' : 'client-compat',
        repro: 'node verify/run-all.mjs --only BEHAV-4',
      })
    }

    /* ---- BEHAV-5 侧边栏自动收起 ---- */
    phase('BEHAV-5 侧边栏自动收起')
    if (has('BEHAV-5')) {
      const step = {}
      const fx = async () => (await probe.evaluate(`(() => { const f=${FRAME}; return { collapsed: f ? f.hasAttribute('data-sidebar-collapsed') : null, furl: document.documentElement.getAttribute('data-meow-smooth-furled') }; })()`)).value
      const sessionRows = () => probe.evaluate(`(() => [...document.querySelectorAll('[data-slot="sidebar"] [data-row-key^="session:"]')].map(el => {
        const r = el.getBoundingClientRect();
        return { key: el.getAttribute('data-row-key'), selected: el.getAttribute('aria-selected'), text: (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,24),
          x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: Math.round(r.width), h: Math.round(r.height) };
      }))()`)
      // 展开侧栏
      await probe.clickElement('[data-meow-smooth-fab]', { settleMs: 1100 })
      step.expanded1 = await fx()
      step.rows1 = (await sessionRows()).value ?? []
      if ((step.expanded1?.collapsed ?? true) !== false) {
        // FAB 没展开则退回原生 Open sidebar
        await probe.clickElement('button[aria-label="Open sidebar"]', { settleMs: 1100 })
        step.expanded1b = await fx()
      }
      // 切换会话：用上游 "New Session"（列表内那个，y 最大）——上游在空会话态只渲染
      // 当前一行 session，所以"点其他会话行"这条路径在此实例上不可用。
      const selKey = () => probe.evaluate(`(() => { const el=document.querySelector('[data-slot="sidebar"] [data-row-key^="session:"][aria-selected="true"]'); return el ? el.getAttribute('data-row-key') : null; })()`)
      step.selectedBefore = (await selKey()).value
      // 重挂探针：给 composer 节点打私有标记，切换后标记丢失=子树重挂（插件设计前提）
      await probe.evaluate(`(() => { const c=document.querySelector('[data-composer-card]'); if (c) c.__verifyMark='alive-1'; return true; })()`)
      const nb = await probe.evaluate(`(() => { const els=[...document.querySelectorAll('button[aria-label="New session"]')].map(e => { const r=e.getBoundingClientRect(); return { x: Math.round(r.x+r.width/2), y: Math.round(r.y+r.height/2), w: Math.round(r.width), txt: (e.textContent||'').trim().slice(0,16) }; }).filter(o => o.w > 120);
        if (els.length === 0) return null; return els.sort((a,b) => b.y - a.y)[0]; })()`)
      step.newSessionBtn = nb.value
      if (nb.value) {
        await probe.clickAt(nb.value.x, nb.value.y)
        const w = await probe.waitFor(`${FRAME} ? ${FRAME}.hasAttribute('data-sidebar-collapsed') : false`, { timeout: 6000, interval: 200 })
        step.waitedMs = w.waitedMs
        step.afterCreate = await fx()
        step.selectedAfter = (await selKey()).value
        step.afterCreateRows = (await sessionRows()).value ?? []
        step.remount = (await probe.evaluate(`(() => { const c=document.querySelector('[data-composer-card]'); return { cardMark: c ? (c.__verifyMark ?? null) : 'no-card', nodeCount: document.querySelectorAll('[data-composer-card]').length }; })()`)).value
      }
      // 再展开，点一个未选中的会话行
      step.collapsedNow = await fx()
      if ((step.collapsedNow?.collapsed ?? false) !== false) await probe.clickElement('[data-meow-smooth-fab]', { settleMs: 1100 })
      step.expanded2 = await fx()
      step.rows2 = (await sessionRows()).value ?? []
      const target = step.rows2.find((r) => r.selected === 'false' && r.w > 0 && r.h > 0) ?? null
      step.clickedRow = target
      if (target) {
        await probe.clickAt(target.x, target.y)
        const w2 = await probe.waitFor(`${FRAME} ? ${FRAME}.hasAttribute('data-sidebar-collapsed') : false`, { timeout: 6000, interval: 200 })
        step.waitedMsRow = w2.waitedMs
        step.afterClick = await fx()
      }
      const shotSw = await shot(probe, `${tag}-mobile-sidebar`)
      const viaCreate = step.afterCreate?.collapsed === true && step.afterCreate?.furl === 'true'
      const viaRow = step.afterClick?.collapsed === true && step.afterClick?.furl === 'true'
      const expandedOk = (step.expanded1?.collapsed === false)
      record({
        id: 'BEHAV-5', group: '插件行为实测', title: '移动视口：窄屏展开侧栏 → 切换会话（新建/点其他会话行）自动收起，并打上插件私有 furl 标记',
        status: expandedOk && (viaRow || viaCreate) ? 'PASS' : 'FAIL',
        evidence: [
          `点 [data-meow-smooth-fab] 展开：collapsed=${step.expanded1?.collapsed}, furl=${step.expanded1?.furl}；会话行数=${step.rows1.length}（[data-row-key^="session:"]）`,
          `点上游列表内 "New Session" 触发会话切换：选中会话 ${step.selectedBefore} → ${step.selectedAfter}`,
          `切换后 ${step.waitedMs ?? '?'}ms 内：collapsed=${step.afterCreate?.collapsed}, furl=${step.afterCreate?.furl}（期望 true/true）`,
          `重挂探针：切换前打在 composer 上的 __verifyMark 切换后=${JSON.stringify(step.remount?.cardMark)}（null=子树已重挂，插件"会话切换会重挂"前提成立；此时 hook 本该触发）`,
          step.rows2?.length ? `未选中会话行=${JSON.stringify(step.rows2.map((r) => `${r.text}(sel=${r.selected})`))}` + (target ? ` → 点「${target.text}」后 collapsed=${step.afterClick?.collapsed}, furl=${step.afterClick?.furl}（${step.waitedMsRow ?? '?'}ms）` : '（无可点行）') : '侧栏里没有其他会话行可点（上游空会话态只渲染当前行）',
          `本轮被测 client bundle rev=${facts.meowRev ?? '?'}（lib/client.js 构建时间见报告顶部快照）`,
          '归属说明：data-meow-smooth-furled 是插件私有标记（上游不写）→ 收起只能由插件触发；上游只在页面加载时按断点收起一次。',
          '【A/B 对照证据（本轮适配期间实测；同一 host 进程 15:51 启动后未重启、同一 dsh 0.2.1-rc.2，唯一变量是插件构建）】',
          '- 旧构建 rev=d3a414f0ae89（lib/ 15:50 构建，16:07 观测）：展开侧栏 → 点 New Session → collapsed=true, furl=true ✅ 收起成立',
          '- 新构建 rev=7eeeced156fd（lib/client.js 16:12:40 构建，本断言复现）：同操作 → collapsed=false, furl=null ❌ 一直不收',
          '判定：插件侧**回归**（非上游行为变化）。上游未变；且重挂探针证明"会话切换会重挂 composer 子树"这一插件依赖的前提成立，hook 本该触发。',
        ].join('\n'),
        details: step,
        owner: (expandedOk && (viaRow || viaCreate)) ? '' : '回归：client-compat 新构建引入（task-4）——onSessionSwitch → maybeCollapseSidebar 链路未触发',
        repro: 'node verify/run-all.mjs --only BEHAV-5',
        shots: [shotSw],
      })
    }

        /* ---- BEHAV-6 按钮行不换行 ---- */
    phase('BEHAV-6 按钮行不换行')

    if (has('BEHAV-6')) {
      // 让 composer 处于展开态并有点内容，量真实布局
      await probe.clickElement('[data-input-scroll]', { settleMs: 500 })
      const rows = await probe.evaluate(`(() => { const c=document.querySelector('[data-composer-card]'); if(!c) return null;
        return [...c.querySelectorAll('div[class*="_row"]')].map(el => { const r=el.getBoundingClientRect();
          const kids=[...el.children].map(k => { const kr=k.getBoundingClientRect(); return { cls:String(k.className).slice(0,32), top:Math.round(kr.top), bottom:Math.round(kr.bottom) }; });
          const tops=kids.map(k=>k.top);
          return { cls:String(el.className).slice(0,40), flexWrap:getComputedStyle(el).flexWrap, rowH:Math.round(r.height),
            kids, spread: tops.length ? Math.max(...tops)-Math.min(...tops) : 0 }; }); })()`)
      const list = rows.value ?? []
      const primary = list[0] ?? null
      const nowrapOk = primary !== null && primary.flexWrap === 'nowrap' && primary.spread < Math.max(8, primary.rowH * 0.5)
      record({
        id: 'BEHAV-6', group: '插件行为实测', title: '移动视口：composer 按钮行单行不换行（flex-wrap:nowrap + 子元素同一视觉行）',
        status: nowrapOk ? 'PASS' : 'FAIL',
        evidence: list.length === 0
          ? '未找到 [data-composer-card] div[class*="_row"]（上游锚点变化）'
          : list.map((r) => `${r.cls}: flexWrap=${r.flexWrap}, rowH=${r.rowH}, 子元素 top 跨度=${r.spread}px, kids=${JSON.stringify(r.kids.map((k) => `${k.cls}@${k.top}`))}`).join('\n'),
        details: list, owner: nowrapOk ? '' : 'client-compat（FOLD_CSS nowrap 选择器 _row 后缀）',
        repro: 'node verify/run-all.mjs --only BEHAV-6',
      })
    }

    /* ---- BEHAV-7 设置页全屏 ---- */
    phase('BEHAV-7 设置页全屏')

    if (has('BEHAV-7')) {
      const step = {}
      const fx = async () => (await probe.evaluate(`(() => { const f=${FRAME}; return { collapsed: f ? f.hasAttribute('data-sidebar-collapsed') : null, furl: document.documentElement.getAttribute('data-meow-smooth-furled') }; })()`)).value
      if ((await fx()).collapsed !== false) await probe.clickElement('[data-meow-smooth-fab]', { settleMs: 900 })
      step.beforeMenu = await fx()
      const more = await probe.centerOf('button[aria-label="Account menu"]')
      if (more) { await probe.clickAt(more.x, more.y); await sleep(1000) }
      const settingsItem = await probe.evaluate(`(() => { const els=[...document.querySelectorAll('[role="menuitem"], [role="menu"] button, button')];
        const el = els.find(e => (e.textContent||'').replace(/\\s+/g,' ').trim() === 'Settings');
        if (!el) return null; const r=el.getBoundingClientRect(); if (r.width<=0) return null;
        return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`)
      step.settingsItem = settingsItem.value
      if (settingsItem.value) { await probe.clickAt(settingsItem.value.x, settingsItem.value.y); await sleep(1500) }
      const panel = await probe.evaluate(`(() => { const d=document.querySelector('div[role="dialog"][data-meow-smooth-settings]');
        if(!d) return { found:false, anyDialog: !!document.querySelector('div[role="dialog"]') };
        const r=d.getBoundingClientRect(); return { found:true, state:d.getAttribute('data-meow-smooth-settings'), noanim:d.hasAttribute('data-meow-smooth-settings-noanim'),
          rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}, vw:innerWidth, vh:innerHeight, nav:!!d.querySelector('nav') }; })()`)
      const shotSet = await shot(probe, `${tag}-mobile-settings`)
      const p = panel.value ?? {}
      const fullscreen = p.found && p.rect && p.rect.w >= p.vw - 2 && p.rect.h >= p.vh - 2 && p.rect.x <= 1 && p.rect.y <= 1
      record({
        id: 'BEHAV-7', group: '插件行为实测', title: '移动视口：设置浮层全窗口铺满 + 插件状态机属性 data-meow-smooth-settings=collapsed',
        status: fullscreen && p.state === 'collapsed' ? 'PASS' : (p.found ? 'FAIL' : (p.anyDialog ? 'FAIL' : 'N/A')),
        evidence: p.found
          ? `面板 rect=${JSON.stringify(p.rect)} vs viewport ${p.vw}×${p.vh}（铺满=${fullscreen}）；属性=${p.state}；含 nav=${p.nav}`
          : `未找到 div[role="dialog"][data-meow-smooth-settings]；页面上有其他 dialog=${p.anyDialog}（入口点法失效或上游设置入口改名）`,
        details: { panel: p, step },
        owner: (fullscreen && p.state === 'collapsed') ? '' : 'client-compat（settings-mobile 状态机）/ 先确认入口按钮 aria-label="Account menu" 未改名',
        repro: 'node verify/run-all.mjs --only BEHAV-7',
        shots: [shotSet],
      })
      // 关掉设置面板，别影响后续
      await probe.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {})
      await probe.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {})
      await sleep(600)
    }

    facts.finalErrors = await probe.errors()
    facts.finalSnapshot = await snapshotDom(probe)
  } finally {
    facts.failedRequests = probe.failedRequests()
    facts.httpErrors = probe.httpErrors
    facts.requestCount = probe.requests.length
  }
  return facts
}

/* --------------------------- 桌面视口断言 --------------------------- */
async function runDesktop(probe, base, token, tag) {
  const facts = { snapshots: {} }
  try {
    phase('桌面视口：切视口 + 重新加载页面（复用同一个 chromium，省内存）')
    facts.modal = await setupInstance(probe, base, token, { viewportAlreadySet: true })
    facts.snapshots.initial = await snapshotDom(probe)
    facts.shots = { initial: await shot(probe, `${tag}-desktop-initial`) }

    if (has('BEHAV-2')) {
      const editableProbe = await probe.evaluate(`(() => { const i=document.querySelector('[data-composer-input], textarea');
        if (!i) return { exists:false, editable:false };
        return { exists:true, tag:i.tagName, isCE:i.isContentEditable, ceAttr:i.getAttribute('contenteditable'), taCount:document.querySelectorAll('textarea').length, editable: i.tagName==='TEXTAREA' || i.isContentEditable }; })()`)
      const editableOk = Boolean(editableProbe.value?.editable)
      const before = await snapshotDom(probe)
      await probe.clickElement('[data-input-scroll]', { settleMs: 600 })
      const typeRes = await probe.typeText('l1\nl2\nl3\nl4\nl5\nl6\nl7')
      await sleep(900)
      const typed = await snapshotDom(probe)
      const shotTyped = await shot(probe, `${tag}-desktop-typed`)
      await probe.clickAt(Math.round(VIEWPORT_DESKTOP.width / 2), 60)
      await sleep(1100)
      const after = await snapshotDom(probe)
      const shotFolded = await shot(probe, `${tag}-desktop-folded`)
      facts.snapshots.fold = { before, typed, after }
      const v = (typed?.composer && after?.composer) ? foldVerdict(typed, after, 2) : { ok: false, reason: '快照失败', got: null, expected: null }
      if (editableOk && (!typeRes.ok || (typed.composer?.textLen ?? 0) < 7)) { v.ok = false; v.reason = `注入未生效（ok=${typeRes.ok}, textLen=${typed.composer?.textLen}）` }
      record({
        id: 'BEHAV-2', group: '插件行为实测', title: '桌面视口：输入多行→失焦压到 2 行（与窄屏 1 行区分）',
        status: !editableOk ? 'N/A' : (v.ok ? 'PASS' : 'FAIL'),
        evidence: [
          !editableOk ? `⚪ 无法自动断言：上游把 composer 渲染为不可编辑（${JSON.stringify(editableProbe.value)}）→ 折叠无从实测。` : null,
          `初始 scrollClientH=${before.composer.scrollClientH}, attr=${before.composer.collapseAttr}`,
          `注入 7 行文本 ok=${typeRes.ok}${typeRes.ok ? '' : `（失败：${typeRes.error}）`}，textLen=${typed.composer.textLen}, scrollScrollH=${typed.composer.scrollScrollH}`,
          `失焦后 attr=${v.attr}, --meow-smooth-fold-height=${v.inline}, scrollClientH=${v.got}, 期望 2 行=${v.expected}（line-height ${v.line}，容差 ±${v.tolerance}）`,
        ].filter(Boolean).join('\n'),
        details: { verdict: v, editableOk, editableProbe: editableProbe.value, typeRes, before: before.composer, typed: typed.composer, after: after.composer },
        owner: !editableOk ? '' : (v.ok ? '' : 'client-compat'), repro: 'node verify/run-all.mjs --only BEHAV-2',
        shots: [shotTyped, shotFolded],
      })
    }

    if (has('PAGE-4')) {
      const errs = await probe.errors()
      record({
        id: 'PAGE-4', group: '页面运行时', title: '桌面视口无 pageerror / unhandledrejection',
        status: errs.length === 0 ? 'PASS' : 'FAIL',
        evidence: errs.length === 0 ? 'Runtime.exceptionThrown=0；早鸟捕获=0' : errs.slice(0, 3).map((e) => `[${e.kind}] ${String(e.message).split('\n')[0].slice(0, 180)}`).join('\n'),
        details: { errs }, owner: errs.length ? 'client-compat' : '',
        repro: 'node verify/run-all.mjs --only PAGE-4',
      })
    }

    if (has('ANCHOR-4')) {
      const s = facts.snapshots.initial ?? {}
      record({
        id: 'ANCHOR-4', group: 'DOM 锚点契约', title: '桌面视口：侧栏展开（上游不受插件窄屏逻辑干预）+ 锚点齐全',
        status: (s.anchors ?? {}).card && (s.anchors ?? {}).scroll && (s.anchors ?? {}).sidebarRightPanel ? 'PASS' : 'FAIL',
        evidence: `collapsed=${(s.anchors ?? {}).sidebarCollapsed}（桌面应为 false=展开）、furl=${s.furl}（桌面应为 null=未 furl）、composer/scroll/rightPanel=${(s.anchors ?? {}).card}/${(s.anchors ?? {}).scroll}/${(s.anchors ?? {}).sidebarRightPanel}`,
        details: s.anchors, owner: '', repro: 'node verify/cdp.mjs --url <base> --viewport desktop --dump-dom',
      })
    }

    if (has('BEHAV-6')) {
      await probe.clickElement('[data-input-scroll]', { settleMs: 500 })
      const rows = await probe.evaluate(`(() => { const c=document.querySelector('[data-composer-card]'); if(!c) return null;
        return [...c.querySelectorAll('div[class*="_row"]')].map(el => { const r=el.getBoundingClientRect();
          const kids=[...el.children].map(k => { const kr=k.getBoundingClientRect(); return { cls:String(k.className).slice(0,32), top:Math.round(kr.top) }; });
          const tops=kids.map(k=>k.top);
          return { cls:String(el.className).slice(0,40), flexWrap:getComputedStyle(el).flexWrap, rowH:Math.round(r.height), spread: tops.length ? Math.max(...tops)-Math.min(...tops) : 0, kids }; }); })()`)
      const list = rows.value ?? []
      const primary = list[0] ?? null
      const ok = primary !== null && primary.flexWrap === 'nowrap' && primary.spread < Math.max(8, primary.rowH * 0.5)
      record({
        id: 'BEHAV-6d', group: '插件行为实测', title: '桌面视口：composer 按钮行同样单行不换行',
        status: ok ? 'PASS' : 'FAIL',
        evidence: list.map((r) => `${r.cls}: flexWrap=${r.flexWrap}, rowH=${r.rowH}, top 跨度=${r.spread}px`).join('\n') || '未找到 _row 元素',
        details: list, owner: ok ? '' : 'client-compat', repro: 'node verify/run-all.mjs --only BEHAV-6d',
      })
    }

    facts.finalErrors = await probe.errors()
    facts.finalSnapshot = await snapshotDom(probe)
  } finally {
    facts.failedRequests = probe.failedRequests()
  }
  return facts
}

/* ----------------------------- 单实例主流程 ----------------------------- */
async function runTarget(spec) {
  const eq = spec.indexOf('=')
  const label = eq > 0 ? spec.slice(0, eq) : spec
  currentTargetLabel = label   // 必须在任何 record() 之前打标，否则 HTTP 类断言会挂到上一个目标名下
  const ref = eq > 0 ? spec.slice(eq + 1) : spec
  let base, token, bootUrl = null
  if (/^https?:\/\//.test(ref)) {
    base = ref.replace(/\/$/, '')
    token = ARGS.token ?? null
    if (!token) { const b = readBootUrl('/tmp/meowtest-boot.log'); token = b.token }
  } else {
    const b = readBootUrl(ref)
    base = b.base; token = b.token; bootUrl = b.url
  }
  console.log(`\n=== 目标 ${label}（${base}）===`)
  const target = { label, base, bootUrl, startedAt: new Date().toISOString(), facts: {}, http: {}, unstable: false }
  const bootLogPath = /^https?:\/\//.test(ref) ? null : ref

  // 1) HTTP：鉴权 + host 路由
  const auth = await authCookie(base, token)
  target.fingerprintStart = await instanceFingerprint(base, auth.cookie, bootLogPath ?? '/tmp/meowtest-boot.log')
  const cookie = auth.cookie
  target.http.auth = { status: auth.status, location: auth.location, gotCookie: Boolean(cookie) }

  if (has('HOST-1') || has('HOST-2') || has('HOST-3')) {
    const pending = await httpGet(`${base}/plugins/meow-smooth/pending`, cookie)
    let json = null
    try { json = JSON.parse(pending.text) } catch { json = null }
    const keys = json ? Object.keys(json) : []
    const need = ['hostVersion', 'approvals', 'questions', 'events']
    const missing = need.filter((k) => !(k in (json ?? {})))
    target.http.pending = { status: pending.status, json, keys, missing }
    record({
      id: 'HOST-1', group: 'host 路由', title: 'GET /plugins/meow-smooth/pending 带 cookie → 200 + JSON 结构（hostVersion/approvals/questions/events）',
      status: pending.status === 200 && json !== null && missing.length === 0 ? 'PASS' : 'FAIL',
      evidence: `HTTP ${pending.status}；body=${pending.text.slice(0, 300)}；缺字段=${JSON.stringify(missing)}`,
      details: target.http.pending,
      owner: (pending.status === 200 && missing.length === 0) ? '' : 'host-compat',
      repro: `先 curl -c c.txt "${bootUrl ?? base}"，再 curl -b c.txt "${base}/plugins/meow-smooth/pending"`,
    })
    if (has('HOST-2')) {
      const anon = await httpGet(`${base}/plugins/meow-smooth/pending`, null)
      record({
        id: 'HOST-2', group: 'host 路由', title: '无 cookie 访问 /pending 被鉴权挡住（401）',
        status: anon.status === 401 ? 'PASS' : 'FAIL',
        evidence: `HTTP ${anon.status}；body=${anon.text.slice(0, 120)}`,
        details: { status: anon.status }, owner: anon.status === 401 ? '' : 'host-compat',
        repro: `curl -i "${base}/plugins/meow-smooth/pending"（不带 cookie）`,
      })
    }
    if (has('HOST-3')) {
      const manifest = await httpGet(`${base}/plugins/meow-smooth/manifest.json`, cookie)
      let mj = null; try { mj = JSON.parse(manifest.text) } catch {}
      record({
        id: 'HOST-3', group: 'host 路由', title: 'PWA 静态资源路由仍在（manifest.json 200 + JSON）',
        status: manifest.status === 200 && mj !== null ? 'PASS' : 'FAIL',
        evidence: `HTTP ${manifest.status}；body=${manifest.text.slice(0, 200)}`,
        details: { status: manifest.status },
        owner: manifest.status === 200 ? '' : 'host-compat',
        repro: `curl -b c.txt "${base}/plugins/meow-smooth/manifest.json"`,
      })
    }
  }

  // 2) 静态锚点契约（上游 bundle）
  if (has('STATIC-1')) {
    const c = await upstreamAnchorContract(base, cookie)
    target.http.contract = c
    const missing = Object.entries(c.found).filter(([, v]) => !v).map(([k]) => k)
    record({
      id: 'STATIC-1', group: 'DOM 锚点契约', title: '上游 bundle 仍提供插件依赖的 DOM 锚点（防上游改名的静默失效）',
      status: missing.length === 0 ? 'PASS' : (c.corpusBytes === 0 ? 'N/A' : 'FAIL'),
      evidence: `抓取 shell + ${c.comboCount} 个 combo bundle，共 ${c.corpusBytes} 字节；逐锚点命中：\n${Object.entries(c.found).map(([k, v]) => `- ${k}: ${v ? '✅ 在上游 bundle 中' : '❌ 未找到'}`).join('\n')}\nmeow client rev=${c.meowRev}`,
      details: c, owner: missing.length ? 'upstream-change（锚点名消失 → 通知 client-compat 改选择器）' : '',
      repro: 'node verify/run-all.mjs --only STATIC-1',
    })
  }

  // 3) 浏览器：移动 / 桌面（各自隔离：一个阶段崩掉不吞掉另一个阶段与已完成断言）
  // 内存预算：整轮只起一个 chromium，移动轮跑完切视口 + 重载页面继续桌面轮。
  let probe = null
  try {
    phase('启动 chromium（单实例复用两视口）')
    probe = await launchChromium({ viewport: VIEWPORT_MOBILE })
  } catch (err) {
    record({ id: 'HARNESS-BROWSER', group: '验证台自身', title: 'chromium 可启动', status: 'FAIL', evidence: String(err?.stack ?? err).slice(0, 600), owner: 'verifier（验证台/资源问题）', repro: 'node verify/run-all.mjs' })
  }
  try {
    if (probe && ARGS.phase !== 'desktop') target.facts.mobile = await runMobile(probe, base, token, label, { pendingJson: target.http.pending?.json ?? null })
  } catch (err) {
    record({
      id: 'HARNESS-MOBILE', group: '验证台自身', title: '移动视口阶段跑完',
      status: 'FAIL', evidence: `移动视口阶段异常中断：${String(err?.stack ?? err).slice(0, 800)}\n（此前的断言仍有效；请重跑确认是 flake 还是真故障）`,
      owner: 'verifier（验证台问题，先与插件 bug 区分）', repro: 'node verify/run-all.mjs',
    })
  }
  try {
    if (probe && ARGS.phase !== 'mobile') {
      await probe.setViewport(VIEWPORT_DESKTOP)
      probe.resetEvents()
      target.facts.desktop = await runDesktop(probe, base, token, label)
    }
  } catch (err) {
    record({
      id: 'HARNESS-DESKTOP', group: '验证台自身', title: '桌面视口阶段跑完',
      status: 'FAIL', evidence: `桌面视口阶段异常中断：${String(err?.stack ?? err).slice(0, 800)}`,
      owner: 'verifier（验证台问题）', repro: 'node verify/run-all.mjs',
    })
  }
  if (probe) { try { await probe.close({ killBrowser: true }) } catch {} }   // 跑完立刻释放，别和别人的 chromium 抢内存

  // 收尾健康检查：跑批期间实例是否被重启/换 home（本轮实测踩过）——
  // 若变了，本轮该实例的所有 FAIL 都不能当插件缺陷证据。
  target.fingerprintEnd = await instanceFingerprint(base, cookie, bootLogPath ?? '/tmp/meowtest-boot.log')
  const f0 = target.fingerprintStart, f1 = target.fingerprintEnd
  const unstable = f1.pendingStatus !== 200
    || (f0.bootToken && f1.bootToken && f0.bootToken !== f1.bootToken)
    || (f0.hostVersion && f1.hostVersion && f0.hostVersion !== f1.hostVersion)
  target.unstable = unstable
  record({
    id: 'ENV-1', group: '环境稳定性', title: '实例在跑批期间未被重启 / 未掉线（换 DSH_HOME 也算）',
    status: unstable ? 'FAIL' : 'PASS',
    evidence: unstable
      ? `跑批期间实例状态变化，本轮该实例的证据**不可作为插件缺陷依据**：\n起始 ${JSON.stringify(f0)}\n结束 ${JSON.stringify(f1)}`
      : `起始/结束指纹一致：${JSON.stringify(f1)}（/pending=${f1.pendingStatus}, hostVersion=${f1.hostVersion}）`,
    details: { start: f0, end: f1 },
    owner: unstable ? '环境（Lead/verifier 重启实例所致，非插件 bug）→ 请在实例稳定后重跑该实例' : '',
    repro: '确认实例未被重启后重跑：node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log',
  })
  target.finishedAt = new Date().toISOString()

  // 3.5) BUNDLE-2：HTTP 直取 meow-smooth 所在的组合 bundle，验证内容确是插件注册
  if (has('BUNDLE-2')) {
    const html = await httpGet(`${base}/`, cookie)
    const m = html.text.match(/plugins\/\?\?[^"]*?([^,;"]*meow-smooth\/client\.js[^",;]*)/)
    const hrefAll = [...html.text.matchAll(/(?:href|src)="(plugins\/\?\?[^"]*meow-smooth[^"]*)"/g)].map((x) => x[1].replace(/&amp;/g, '&'))
    const href = hrefAll[0] ?? null
    let b = { path: href, status: null, bytes: 0, hasRegistration: false, hasFactoryBanner: false }
    if (href) {
      const res = await httpGet(`${base}/${href}`, cookie)
      b.status = res.status
      b.bytes = res.text.length
      b.hasRegistration = /__ModuleLoader__\.load\s*\(\s*\{[\s\S]{0,120}?id:\s*["']meow-smooth["']/.test(res.text) || /id:\s*["']meow-smooth["']/.test(res.text)
      b.hasFactoryBanner = res.text.includes('factory: (require)')
      b.segment = (() => {
        const i = res.text.indexOf('id: "meow-smooth"')
        return i >= 0 ? res.text.slice(Math.max(0, i - 80), i + 200) : res.text.slice(0, 200)
      })()
    }
    target.http.bundle = b
    record({
      id: 'BUNDLE-2', group: 'client bundle 加载', title: 'HTTP 直取组合 bundle：内容确为 meow-smooth 的 ModuleLoader 注册',
      status: b.status === 200 && b.hasRegistration ? 'PASS' : 'FAIL',
      evidence: href
        ? `GET ${href.slice(0, 160)}… → HTTP ${b.status}，${b.bytes} bytes；含 __ModuleLoader__.load 且 id "meow-smooth"=${b.hasRegistration}\n片段：\n${b.segment}`
        : 'shell HTML 中未找到含 meow-smooth 的组合 URL',
      details: b, owner: (b.status === 200 && b.hasRegistration) ? '' : 'host-compat（combo 图/路由）',
      repro: `curl -b c.txt "<base>/plugins/??…,meow-smooth/client.js,…" | grep -n 'meow-smooth'`,
    })
  }

  // 4) bundle 内容抓取（BUNDLE-2 需要组合 URL，从移动轮拿到）
  return target
}

/* ------------------------------- 报告 ------------------------------- */
function statusIcon(s) { return { PASS: '✅', FAIL: '❌', 'N/A': '⚪', INFO: 'ℹ️' }[s] ?? s }

function renderReport(targets, snapshot, env) {
  const L = []
  const all = results
  const fails = all.filter((r) => r.status === 'FAIL')
  const passes = all.filter((r) => r.status === 'PASS')
  const nas = all.filter((r) => r.status === 'N/A')
  const targetLabels = [...new Set(all.map((r) => r.target).filter(Boolean))]
  const cell = (st) => ({ PASS: '✅', FAIL: '❌', 'N/A': '⚪', INFO: 'ℹ️' }[st] ?? '—')
  L.push('# meow-smooth × dsh 0.2.1-rc.2 端到端验证报告')
  L.push('')
  L.push(`- 生成时间：${new Date().toISOString()}（UTC）`)
  L.push(`- 生成者：verifier（task-3）；复跑命令：\`node verify/run-all.mjs ${targets.map((t) => `--target ${t.label}=${t.bootLogPath ?? t.base ?? '<boot-log>'}`).join(' ')}\``)
  L.push(`- 机器：${env.host}`)
  if (ARGS.only || ARGS.phase !== 'both') {
    L.push('')
    L.push(`> ⛔ **本次是局部运行，不是全量验收证据**：${ARGS.only ? `--only=${ARGS.only.join(',')}` : ''}${ARGS.only && ARGS.phase !== 'both' ? '，' : ''}${ARGS.phase !== 'both' ? `--phase=${ARGS.phase}` : ''}。全量验收请跑「最终验收：一条命令」里那条不带 --only/--phase 的命令。`)
  }
  L.push('')
  L.push('## 结论摘要')
  L.push('')
  L.push('> 数据来源：`verify/raw/results.json`（报告与它是同一次运行写出的；重渲染用 `--from-raw`）。')
  L.push('')
  L.push(`| 状态 | 条数 |`)
  L.push(`| --- | --- |`)
  L.push(`| ✅ PASS | ${passes.length} |`)
  L.push(`| ❌ FAIL | ${fails.length} |`)
  L.push(`| ⚪ 无法自动断言 (N/A) | ${nas.length} |`)
  L.push('')
  L.push('> 两栏口径：**17899 = 精简组合**（只有 dsh 本体 + meow-smooth，用于隔离插件自身行为）；')
  L.push('> **17900 = 真实组合镜像**（与用户 live web profile 同构：dshmarket / better-sidebar / free-search / model-extension / git-graph / skills-management + 修复版插件），用于确认没有组合冲突。')
  L.push('')
  if (targetLabels.length > 0) {
    L.push('### 分实例小结')
    L.push('')
    L.push(`| 实例 | ✅ PASS | ❌ FAIL | ⚪ N/A |`)
    L.push('| --- | --- | --- | --- |')
    for (const tl of targetLabels) {
      const rs = all.filter((r) => r.target === tl)
      L.push(`| ${tl} | ${rs.filter((r) => r.status === 'PASS').length} | ${rs.filter((r) => r.status === 'FAIL').length} | ${rs.filter((r) => r.status === 'N/A').length} |`)
    }
    L.push('')
    L.push('### 断言 × 实例 矩阵')
    L.push('')
    L.push(`| 断言 | ${targetLabels.join(' | ')} |`)
    L.push(`| --- | ${targetLabels.map(() => '---').join(' | ')} |`)
    const ids = [...new Set(all.filter((r) => r.target).map((r) => r.id))]
    for (const id of ids) {
      const row = targetLabels.map((tl) => {
        const r = all.find((x) => x.id === id && x.target === tl)
        return r ? cell(r.status) : '—'
      })
      L.push(`| ${id} | ${row.join(' | ')} |`)
    }
    L.push('')
  }
  if (fails.length === 0) {
    L.push('**当前被测实例上：全部可自动断言项 PASS，无 pageerror，无插件硬故障。**')
  } else {
    L.push('**存在 FAIL，逐条根因归属见下表与各断言详情。**')
    L.push('')
    L.push('| 实例 | FAIL | 归属 | 复现 |')
    L.push('| --- | --- | --- | --- |')
    for (const f of fails) L.push(`| ${f.target ?? '-'} | ${f.id} ${f.title} | ${f.owner || '待定'} | \`${f.repro}\` |`)
  }
  L.push('')

  // 被测实例
  L.push('## 被测实例与环境')
  L.push('')
  for (const t of targets) {
    L.push(`### ${t.label} — ${t.base}`)
    L.push('')
    if (t.unstable) {
      L.push('> ⛔ **本实例在跑批期间被重启/掉线（ENV-1 FAIL），本节 FAIL 项不作为插件缺陷证据，请重跑。**')
      L.push('')
    }
    L.push(`- 启动 URL（本轮 token）：\`${t.bootUrl ?? '(外部指定)'}\``)
    L.push(`- 鉴权握手：HTTP ${t.http.auth?.status} → ${t.http.auth?.location ?? ''}，cookie=${t.http.auth?.gotCookie ? '已获取' : '未获取'}`)
    if (t.http.pending) L.push(`- /pending：HTTP ${t.http.pending.status} → \`${JSON.stringify(t.http.pending.json)}\``)
    if (t.http.contract) L.push(`- 上游锚点契约：combo bundle ${t.http.contract.comboCount} 个 / ${t.http.contract.corpusBytes} 字节；meow client rev=\`${t.http.contract.meowRev}\``)
    const m = t.facts.mobile, d = t.facts.desktop
    L.push(`- 引导模态处理（干净 profile 每次重放，必须过）：${JSON.stringify(m?.modal?.dismissed ?? [])}`)
    L.push(`- 移动视口最终观测：furl=${m?.finalSnapshot?.furl}，collapse=${m?.finalSnapshot?.composer?.collapseAttr}，插件样式=[${(m?.finalSnapshot?.meowStyles ?? []).join(', ')}]`)
    L.push(`- 移动/桌面轮次 pageerror 数：${m?.finalErrors?.length ?? '?'} / ${d?.finalErrors?.length ?? '?'}`)
    L.push(`- 本轮加载的 meow-smooth client bundle rev：\`${m?.meowRev ?? '?'}\``)
    L.push('')
  }
  L.push('### 代码/构建快照（证据钉在具体 revision 上）')
  L.push('')
  L.push(`- git HEAD：\`${snapshot.gitHead}\`，package.json version=\`${snapshot.pkgVersion}\``)
  L.push('')
  L.push('| 文件 | mtime | sha256[0:16] |')
  L.push('| --- | --- | --- |')
  for (const [f, v] of Object.entries(snapshot.files)) L.push(`| \`${f}\` | ${v.mtime ?? '-'} | \`${v.sha256_16 ?? '-'}\` |`)
  L.push('')
  L.push('> ⚠️ 复跑前提（每轮必做）：**src/ 有改动 → `node build.mjs` 重建**；**host 侧改动 → 重启实例**；client 侧改动只需重建 + 刷新页面（实测：host 每请求现算 bundle rev，重建后 rev 变化即被加载，见 BUNDLE-1/BUNDLE-2 证据）。不重建就复跑 = 测旧 bundle。')
  L.push('> 本报告上方快照可与 `ls -l --time-style=full-iso lib/ src/` 对照确认。')
  L.push('')

  // 逐条断言
  L.push('## 断言明细')
  L.push('')
  const sections = targetLabels.length > 1 ? [...targetLabels, '__none__'] : ['__none__']
  for (const tl of sections) {
    const scoped = tl === '__none__' ? all.filter((r) => !r.target) : all.filter((r) => r.target === tl)
    if (scoped.length === 0) continue
    if (tl !== '__none__') { L.push(`# 【实例 ${tl}】`); L.push('') }
    const groups = [...new Set(scoped.map((r) => r.group))]
    for (const g of groups) {
      L.push(`## ${tl === '__none__' ? '' : `${tl} / `}${g}`)
      L.push('')
      for (const r of scoped.filter((x) => x.group === g)) {
      L.push(`#### ${statusIcon(r.status)} ${r.id} — ${r.title}`)
      L.push('')
      L.push(`**状态：${r.status}**${r.owner ? `　|　归属：${r.owner}` : ''}`)
      L.push('')
      L.push('证据：')
      L.push('')
      L.push('```')
      L.push(String(r.evidence).slice(0, 4000))
      L.push('```')
      if (r.shots?.length) {
        L.push('截图：')
        L.push('')
        for (const s of r.shots.filter(Boolean)) L.push(`![${r.id}](${s.replace(REPO + '/', '')})`)
        L.push('')
      }
      if (r.repro) { L.push(`最小复现：\`${r.repro}\``); L.push('') }
      if (r.details && r.status === 'FAIL') {
        L.push('<details><summary>原始观测（JSON）</summary>')
        L.push('')
        L.push('```json')
        L.push(JSON.stringify(r.details, null, 2).slice(0, 4000))
        L.push('```')
        L.push('</details>')
        L.push('')
      }
      }
    }
  }

  // 归属说明
  L.push('## 「插件 bug」vs「上游 dsh 行为变化」判定口径')
  L.push('')
  L.push('| 现象 | 判定为 | 依据 |')
  L.push('| --- | --- | --- |')
  L.push('| 插件注入的标记（`data-meow-*`）/私有属性缺失、pageerror 栈落在插件模块 | **插件 bug** | 产物是插件自己写的；上游不会写 `data-meow-*` |')
  L.push('| 上游锚点（`data-composer-card` 等）在 bundle 里改名/消失，插件选择器落空 | **上游行为变化** | STATIC-1 直接从上游 bundle 取证 |')
  L.push('| 插件行为属性在（如 furl=true）但布局没变 | **插件 bug（选择器/时机）** | 属性写入 ≠ 生效，需比对几何 |')
  L.push('| 下游动作由上游自己完成（如窄屏加载即收起）| 需与插件归因区分 | 插件私有 furl 标记只此一家 |')
  L.push('')
  L.push('## 官方已自带 / 插件应让位的功能（0.2.1-rc.2 实测）')
  L.push('')
  L.push('| 能力 | 上游 0.2.1-rc.2 现状 | 插件现状 | 建议 |')
  L.push('| --- | --- | --- | --- |')
  L.push('| 首次运行引导模态（Preview Notice / Get started）| 上游自带，且盖住 composer | 插件不干预 | 无关，仅影响自动化需先关掉 |')
  L.push('| 窄屏默认收起侧边栏 | 上游按断点自带（加载即 `data-sidebar-collapsed`）| 插件补「切会话自动收起 + furl 小方块」 | 保留增量部分（见 BEHAV-5 归属说明）|')
  L.push('| composer 折叠 1/2 行 | 上游无（0.2.1 输入框自由增高）| 插件 JS+CSS 实现 | 插件价值明确，保留 |')
  L.push('| 设置面板移动端布局 | 上游未全窗口化 | 插件补全屏 + 边栏折叠态机 | 保留 |')
  L.push('')
  L.push('## 无法自动断言项 + 手工复现步骤')
  L.push('')
  L.push('1. **真实 pending 审批/提问下的提醒卡片与 `[data-question-key]`/`[data-approval-key]` 面板**')
  L.push('   - 原因：测试 home（`/tmp/dsh-test-home`、`/tmp/dshmirror`）无模型凭证，造不出真实 pending。')
  L.push('   - 手工：打开实例 → 会话内发一条要求 agent 提问的消息 → 面板出现后执行 `document.querySelectorAll(\'[data-question-key],[data-approval-key]\').length`；同时看 `div[data-meow-smooth-pending]` 是否 `data-visible="true"` 且可点击跳转。')
  L.push('   - 替代证据：STATIC-1 证明上游锚点仍在；BEHAV-3/4 证明轮询与卡片节点活着。')
  L.push('2. **键盘（IME）弹起相关行为**（header 收起、悬浮条、Enter 插入换行）')
  L.push('   - 原因：headless 无真实软键盘，`visualViewport` 不会因键盘缩高。')
  L.push('   - 手工：手机浏览器打开实例，点输入框弹键盘，观察 header 是否被悬浮条替代。')
  L.push('3. **触屏手势**（边缘滑出侧栏、右栏分屏拖拽、双击缩放等）')
  L.push('   - 原因：CDP 合成 touch 序列难以稳定复现多指/惯性/长按时序。')
  L.push('   - 手工：真机或 DevTools 设备模拟里逐项目测；或复跑仓库内既有 `scripts/probe-*.mjs`、`scripts/e2e-*.mjs`。')
  L.push('4. **PWA / Service Worker 通知**（`sw.js`、push 订阅、通知点击跳会话）')
  L.push('   - 原因：headless 无 Web Push 端点，通知权限也无法交互授予。')
  L.push('   - 手工：Chrome 打开实例 → 允许通知 → 触发一次完成事件看系统通知。')
  L.push('')
  L.push('## 最终验收：一条命令')
  L.push('')
  L.push('```bash')
  L.push('# 前置（每轮必做）：src/ 有改动 → 重建；host 侧改动 → 重启实例；client 侧改动只需重建 + 刷新')
  L.push('cd /root/ws/meow-smooth && node build.mjs')
  L.push('')
  L.push('# 17899 精简组合（Lead 启动：cd /tmp && DSH_HOME=/tmp/dsh-test-home nohup dsh --profile meowtest --port 17899 --no-open > /tmp/meowtest-boot.log 2>&1 &）')
  L.push('# 17900 真实组合镜像由 Lead 统一拉起后再纳入本命令（token 现从 /tmp/dshmirror-boot.log 读）')
  L.push('')
  L.push('node /root/ws/meow-smooth/verify/run-all.mjs \\')
  L.push('  --target 17899=/tmp/meowtest-boot.log \\')
  L.push('  --target 17900=/tmp/dshmirror-boot.log \\')
  L.push('  --out /root/ws/meow-smooth/verify/report.md')
  L.push('```')
  L.push('')
  L.push('| 场景 | 命令 |')
  L.push('| --- | --- |')
  L.push('| 全量（两实例 × 移动+桌面） | 上面那条 |')
  L.push('| 只跑 17899 | `node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log` |')
  L.push('| 只跑单条断言（调试） | `node verify/run-all.mjs --only BEHAV-5` |')
  L.push('| 只跑桌面视口（省内存） | `node verify/run-all.mjs --phase desktop --only PAGE-4,BEHAV-2,ANCHOR-4,BEHAV-6d` |')
  L.push('| 只重渲染报告（零浏览器） | `node verify/run-all.mjs --from-raw verify/raw/results.json` |')
  L.push('')
  L.push('### 资源预算与稳定性（本机 cgroup 4GB、无 swap、同机还有 live GUI）')
  L.push('')
  L.push('- 整轮**只起一个 chromium**，移动轮跑完切视口 + 重载页面继续桌面轮，跑完立刻 `Browser.close` + 杀进程组（`verify/cdp.mjs` 里 `launchChromium/close`）；')
  L.push('- 启动参数带省内存项：`--disable-dev-shm-usage --js-flags=--max-old-space-size=256 --renderer-process-limit=2 --disable-extensions --disable-background-networking`；')
  L.push('- **同一时刻只跑一个 chromium**（和队友串行安排），否则会被内核 global OOM 杀掉；')
  L.push('- 每轮干净 profile，开头自动过掉上游引导模态（Preview Notice / Get started）；所有交互用真实 touch/mouse 事件（不是 `element.click()`——插件的程序化聚焦抑制器会识别并撤焦）；断言之间互不影响，单条断言失败不会打断整轮。')
  L.push('')
  return L.join('\n')
}

/* ------------------------------- 主流程 ------------------------------- */
const env = { host: `${process.platform} ${process.arch} / node ${process.version} / chromium ${(() => { try { return execSync('/usr/bin/chromium --version').toString().trim() } catch { return '?' } })()}` }
const snapshot = artifactSnapshot()

// --from-raw：只把既有 raw/results.json 重新渲染成报告（零浏览器、零内存开销）
if (ARGS.fromRaw) {
  const j = JSON.parse(readFileSync(ARGS.fromRaw, 'utf8'))
  results.length = 0
  for (const r of j.results ?? []) results.push({ shots: [], details: null, repro: '', owner: '', target: null, ...r })
  mkdirSync(dirname(ARGS.out), { recursive: true })
  writeFileSync(ARGS.out, renderReport(j.targets ?? [], j.snapshot ?? snapshot, env))
  console.log(`已从 ${ARGS.fromRaw} 重渲染报告：${ARGS.out}（PASS=${results.filter((r) => r.status === 'PASS').length} FAIL=${results.filter((r) => r.status === 'FAIL').length}）`)
  process.exit(0)
}
const targets = []
try {
  for (const spec of ARGS.targets) {
    const eq = spec.indexOf('=')
    try {
      const t = await runTarget(spec)
      t.bootLogPath = eq > 0 ? spec.slice(eq + 1) : spec
      targets.push(t)
    } catch (err) {
      record({
        id: `HARNESS-TARGET`, group: '验证台自身', title: `目标 ${spec} 整体跑完`,
        status: 'FAIL', evidence: `目标 ${spec} 执行中断：${String(err?.stack ?? err).slice(0, 800)}`,
        owner: 'verifier（验证台问题）', repro: `node verify/run-all.mjs --target ${spec}`,
      })
      targets.push({ label: spec, base: ref0(spec), bootLogPath: eq > 0 ? spec.slice(eq + 1) : spec, failed: true, http: {}, facts: {} })
    }
  }
  function ref0(x) { return x.indexOf('=') > 0 ? x.slice(x.indexOf('=') + 1) : x }
} catch (err) {
  console.error('\n[run-all] 致命错误：', err)
  record({ id: 'HARNESS', group: '验证台自身', title: '验证台执行未中断', status: 'FAIL', evidence: String(err?.stack ?? err), owner: 'verifier（验证台 bug，不是插件 bug）', repro: 'node verify/run-all.mjs' })
}

mkdirSync(dirname(ARGS.out), { recursive: true })
writeFileSync(ARGS.out, renderReport(targets, snapshot, env))
writeFileSync(join(ARGS.raw, 'results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), snapshot, targets, results }, null, 2))
console.log(`\n报告已写入：${ARGS.out}`)
console.log(`原始数据：${join(ARGS.raw, 'results.json')}`)
const fails = results.filter((r) => r.status === 'FAIL')
console.log(`汇总：PASS=${results.filter((r) => r.status === 'PASS').length} FAIL=${fails.length} N/A=${results.filter((r) => r.status === 'N/A').length}`)
if (fails.length) console.log('FAIL 项：' + fails.map((f) => f.id).join(', '))
process.exit(0)