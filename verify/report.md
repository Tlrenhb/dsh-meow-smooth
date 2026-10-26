> 📌 **复现性证据（verifier 标注）**：同一条命令**连跑两次**（run1 / run2），50 条断言的状态**逐条完全一致**（各 48 PASS / 0 FAIL / 2 N-A）→ 报告可复现。
> 两次原始数据：`verify/raw/results-combined-run1.json`、`verify/raw/results.json`（run2 即"最近一次"）；对应报告：`verify/raw/report-combined-run1.md`、`verify/raw/report-combined-run2.md`。
> 另有 **旧版不回归冒烟（dsh 0.1.5-rc.1）** 一节见文末（子集验收，非全量）。
> 被测产物冻结快照：`lib/client.js` sha256[0:16] `f036a03d0e7bd6c3`、`lib/index.js` `31b31f6023adc624`、package.json `0.8.2`、`engines.dsh >=0.1.5`、hostVersion `0.8.2`。

# meow-smooth × dsh 0.2.1-rc.2 端到端验证报告

- 生成时间：2026-10-26T04:47:28.674Z（UTC）
- 生成者：verifier（task-3）；复跑命令：`node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log --target 17900=/tmp/dshmirror-boot.log`
- 机器：linux x64 / node v25.6.0 / chromium Chromium 155.0.8059.39 built on Debian GNU/Linux 12 (bookworm)

## 结论摘要

> 数据来源：`verify/raw/results.json`（报告与它是同一次运行写出的；重渲染用 `--from-raw`）。

| 状态 | 条数 |
| --- | --- |
| ✅ PASS | 48 |
| ❌ FAIL | 0 |
| ⚪ 无法自动断言 (N/A) | 2 |

> 两栏口径：**17899 = 精简组合**（只有 dsh 本体 + meow-smooth，用于隔离插件自身行为）；
> **17900 = 真实组合镜像**（与用户 live web profile 同构：dshmarket / better-sidebar / free-search / model-extension / git-graph / skills-management + 修复版插件），用于确认没有组合冲突。

### 分实例小结

| 实例 | ✅ PASS | ❌ FAIL | ⚪ N/A |
| --- | --- | --- | --- |
| 17899 | 24 | 0 | 1 |
| 17900 | 24 | 0 | 1 |

### 断言 × 实例 矩阵

| 断言 | 17899 | 17900 |
| --- | --- | --- |
| HOST-1 | ✅ | ✅ |
| HOST-2 | ✅ | ✅ |
| HOST-3 | ✅ | ✅ |
| STATIC-1 | ✅ | ✅ |
| PAGE-1 | ✅ | ✅ |
| PAGE-2 | ✅ | ✅ |
| PAGE-3 | ✅ | ✅ |
| BUNDLE-1 | ✅ | ✅ |
| BUNDLE-3 | ✅ | ✅ |
| BUNDLE-4 | ✅ | ✅ |
| ANCHOR-1 | ✅ | ✅ |
| ANCHOR-2 | ✅ | ✅ |
| ANCHOR-3 | ⚪ | ⚪ |
| BEHAV-1 | ✅ | ✅ |
| BEHAV-3 | ✅ | ✅ |
| BEHAV-4 | ✅ | ✅ |
| BEHAV-5 | ✅ | ✅ |
| BEHAV-6 | ✅ | ✅ |
| BEHAV-7 | ✅ | ✅ |
| BEHAV-2 | ✅ | ✅ |
| PAGE-4 | ✅ | ✅ |
| ANCHOR-4 | ✅ | ✅ |
| BEHAV-6d | ✅ | ✅ |
| ENV-1 | ✅ | ✅ |
| BUNDLE-2 | ✅ | ✅ |

**当前被测实例上：全部可自动断言项 PASS，无 pageerror，无插件硬故障。**

## 被测实例与环境

### 17899 — http://127.0.0.1:17899

- 启动 URL（本轮 token）：`http://127.0.0.1:17899/?token=ESRmjeWD01YjLCYoCGMoCU_fPbFxQgH9AzCqaSt9TMQ`
- 鉴权握手：HTTP 303 → ./，cookie=已获取
- /pending：HTTP 200 → `{"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}`
- 上游锚点契约：combo bundle 3 个 / 12212523 字节；meow client rev=`30c9aa7fd22e`
- 引导模态处理（干净 profile 每次重放，必须过）：[{"head":"Get started / Sign in to your DeepSeek account or add an API Key to get started. Your proj","action":"clicked \"Close\"","buttons":["Close","Add API Key","Sign in"]}]
- 移动视口最终观测：furl=null，collapse=collapsed，插件样式=[fold-css, settings-css, gesture-css]
- 移动/桌面轮次 pageerror 数：0 / 0
- 本轮加载的 meow-smooth client bundle rev：`bff89162f8bb`

### 17900 — http://127.0.0.1:17900

- 启动 URL（本轮 token）：`http://127.0.0.1:17900/?token=P0pO7a3B-epG2T5VfyHvfu0lUhbK-gwGShsOVxntfrc`
- 鉴权握手：HTTP 303 → ./，cookie=已获取
- /pending：HTTP 200 → `{"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}`
- 上游锚点契约：combo bundle 3 个 / 15133111 字节；meow client rev=`30c9aa7fd22e`
- 引导模态处理（干净 profile 每次重放，必须过）：[]
- 移动视口最终观测：furl=null，collapse=collapsed，插件样式=[fold-css, settings-css, gesture-css]
- 移动/桌面轮次 pageerror 数：0 / 0
- 本轮加载的 meow-smooth client bundle rev：`2bc9c680d6e6`

### 代码/构建快照（证据钉在具体 revision 上）

- git HEAD：`b9e5f4e`，package.json version=`0.8.2`

| 文件 | mtime | sha256[0:16] |
| --- | --- | --- |
| `src/client.ts` | 2026-10-26T04:37:10.472Z | `0c7bbd8930a7349a` |
| `src/index.ts` | 2026-10-26T04:10:30.475Z | `e13fbb36be9f1956` |
| `src/notify-host.ts` | 2026-10-25T15:56:02.469Z | `405aa288099b508a` |
| `src/notify-client.ts` | 2026-10-25T15:38:10.536Z | `47e987ea9f8bcb08` |
| `src/settings-mobile.ts` | 2026-10-26T04:36:04.854Z | `c62e5346de31ae0b` |
| `src/sidebar-gesture.ts` | 2026-10-25T15:38:10.537Z | `587031bbdbab2357` |
| `src/auth-gate.ts` | 2026-10-25T15:50:24.709Z | `7b2a5dc88290ee8d` |
| `src/compress-proxy.ts` | 2026-10-25T15:49:15.449Z | `f6ff1225fd10812a` |
| `lib/client.js` | 2026-10-26T04:40:29.806Z | `f036a03d0e7bd6c3` |
| `lib/index.js` | 2026-10-26T04:40:29.802Z | `31b31f6023adc624` |
| `package.json` | 2026-10-26T04:10:19.886Z | `f9ab5ae875488150` |

> ⚠️ 复跑前提（每轮必做）：**src/ 有改动 → `node build.mjs` 重建**；**host 侧改动 → 重启实例**；client 侧改动只需重建 + 刷新页面（实测：host 每请求现算 bundle rev，重建后 rev 变化即被加载，见 BUNDLE-1/BUNDLE-2 证据）。不重建就复跑 = 测旧 bundle。
> 本报告上方快照可与 `ls -l --time-style=full-iso lib/ src/` 对照确认。

## 断言明细

# 【实例 17899】

## 17899 / host 路由

#### ✅ HOST-1 — GET /plugins/meow-smooth/pending 带 cookie → 200 + JSON 结构（hostVersion/approvals/questions/events）

**状态：PASS**

证据：

```
HTTP 200；body={"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}；缺字段=[]
```
最小复现：`先 curl -c c.txt "http://127.0.0.1:17899/?token=ESRmjeWD01YjLCYoCGMoCU_fPbFxQgH9AzCqaSt9TMQ"，再 curl -b c.txt "http://127.0.0.1:17899/plugins/meow-smooth/pending"`

#### ✅ HOST-2 — 无 cookie 访问 /pending 被鉴权挡住（401）

**状态：PASS**

证据：

```
HTTP 401；body=unauthorized
```
最小复现：`curl -i "http://127.0.0.1:17899/plugins/meow-smooth/pending"（不带 cookie）`

#### ✅ HOST-3 — PWA 静态资源路由仍在（manifest.json 200 + JSON）

**状态：PASS**

证据：

```
HTTP 200；body={"id":"/","name":"dsh meow","short_name":"dsh","display":"standalone","start_url":"/","scope":"/","background_color":"#312E81","theme_color":"#4F46E5","icons":[{"src":"/plugins/meow-smooth/icon-180.pn
```
最小复现：`curl -b c.txt "http://127.0.0.1:17899/plugins/meow-smooth/manifest.json"`

## 17899 / DOM 锚点契约

#### ✅ STATIC-1 — 上游 bundle 仍提供插件依赖的 DOM 锚点（防上游改名的静默失效）

**状态：PASS**

证据：

```
抓取 shell + 3 个 combo bundle，共 12212523 字节；逐锚点命中：
- data-composer-card: ✅ 在上游 bundle 中
- data-input-scroll: ✅ 在上游 bundle 中
- data-composer-input: ✅ 在上游 bundle 中
- data-sidebar-collapsed: ✅ 在上游 bundle 中
- data-sidebar-right-panel: ✅ 在上游 bundle 中
- data-sidebar-right-open: ✅ 在上游 bundle 中
- data-slot: ✅ 在上游 bundle 中
- data-row-key: ✅ 在上游 bundle 中
- data-question-key: ✅ 在上游 bundle 中
- data-approval-key: ✅ 在上游 bundle 中
- data-plan-review-key: ✅ 在上游 bundle 中
meow client rev=30c9aa7fd22e
```
最小复现：`node verify/run-all.mjs --only STATIC-1`

#### ✅ ANCHOR-1 — 核心 composer / 侧栏锚点存在

**状态：PASS**

证据：

```
[data-composer-card]: true
[data-input-scroll]: true
[data-composer-input]: true
[data-sidebar-right-panel]: true
```
最小复现：`node verify/cdp.mjs --url <base> --selectors "[data-composer-card],[data-input-scroll],[data-composer-input],[data-sidebar-right-panel]"`

#### ✅ ANCHOR-2 — 消息操作行 / 侧边栏折叠锚点

**状态：PASS**

证据：

```
[data-sidebar-collapsed]=true（窄屏默认收起态由上游渲染）；消息操作行=false（空会话无消息时上游不渲染，属正常）
```
最小复现：`在移动视口打开一个已有消息的会话后复查 [data-slot="message.actions"]`

#### ⚪ ANCHOR-3 — pending 交互锚点 [data-question-key]/[data-approval-key]

**状态：N/A**

证据：

```
无法自动断言：测试 home 无模型凭证（.credentials.yaml 只有 browser-session grant），无法驱动真实 agent 轮次造出 pending question/approval。
当前页面：questionKey=false, approvalKey=false（无 pending 时上游本就不渲染，非缺陷）。
替代证据见 STATIC-1（上游 bundle 仍提供这两个锚点）+ 手工复现步骤见报告末节。
```
最小复现：`手工：在 17899/17900 打开一个会话 → 发一条会触发提问的消息（如要求 agent 用 ask_user_question 提问）→ 面板出现后查 [data-question-key]；审批同理用会触发审批的工具。`

#### ✅ ANCHOR-4 — 桌面视口：侧栏展开（上游不受插件窄屏逻辑干预）+ 锚点齐全

**状态：PASS**

证据：

```
collapsed=false（桌面应为 false=展开）、furl=null（桌面应为 null=未 furl）、composer/scroll/rightPanel=true/true/true
```
最小复现：`node verify/cdp.mjs --url <base> --viewport desktop --dump-dom`

## 17899 / 页面运行时

#### ✅ PAGE-1 — 移动视口整轮无 pageerror（插件脚本硬故障的第一信号）

**状态：PASS**

证据：

```
Runtime.exceptionThrown=0；注入式早鸟 window.__verifyErrors 中 error 类 0 条；Network.loadingFailed=0
```
截图：

![PAGE-1](verify/shots/17899-mobile-initial.png)

#### ✅ PAGE-2 — 无 unhandledrejection（未捕获 promise 拒绝）

**状态：PASS**

证据：

```
unhandledrejection=0
```
最小复现：`node verify/run-all.mjs --only PAGE-2`

#### ✅ PAGE-3 — 被测实例同源资源无失败请求 / 无 4xx-5xx

**状态：PASS**

证据：

```
同源 loadingFailed=0；同源 HTTP 错误=0（含 /plugins/meow-smooth/* 全部 200）
无第三方资源失败
```
最小复现：`node verify/run-all.mjs --only PAGE-3`

#### ✅ PAGE-4 — 桌面视口无 pageerror / unhandledrejection

**状态：PASS**

证据：

```
Runtime.exceptionThrown=0；早鸟捕获=0
```
最小复现：`node verify/run-all.mjs --only PAGE-4`

## 17899 / client bundle 加载

#### ✅ BUNDLE-1 — shell 组合 URL 包含并成功加载 meow-smooth/client.js

**状态：PASS**

证据：

```
resource timing 命中 1 条：
- http://127.0.0.1:17899/plugins/??@deepseek-ai/dsh-client-ui-trajectory/client.js,meow-smooth/client.js,@deepseek-ai/dsh-api-remote-access/client.js,@deepseek-ai/dsh-session-log-export/client.js,@deeps…
```
最小复现：`node verify/cdp.mjs --url <base> --token <t> --eval "performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/meow-smooth/.test(n))"`

#### ✅ BUNDLE-3 — 插件注入的三张样式表都在 DOM（fold / gesture / settings）

**状态：PASS**

证据：

```
style[data-plugin="meow-smooth"] = [fold-css, settings-css, gesture-css]
```
最小复现：`document.querySelectorAll('style[data-plugin="meow-smooth"]')`

#### ✅ BUNDLE-4 — 插件运行时产物存在（html 标记 + FAB + pending 条 + dispose 钩子）

**状态：PASS**

证据：

```
html[data-meow-smooth-gesture-loaded]=true，html[data-meow-apply-stage]=true
button[data-meow-smooth-fab]=true，div[data-meow-smooth-pending]=true
typeof window.__meowSmoothClientDispose=function
带 data-meow* 属性的节点 7 个：HTML[data-meow-apply-stage=suppressor-registered data-meow-smooth-gesture-loaded=v6.3-tap data-meow-smooth-furled=true] / STYLE[data-meow-fold-css=true data-meow-sheet-epoch=1 data-meow-sheet-born=1792989967649] / STYLE[data-meow-smooth-settings-css=true] / STYLE[data-meow-smooth-gesture-css=true] / DIV[data-meow-smooth=collapsed] / BUTTON[data-meow-smooth-fab=true data-meow-h=40]
```
最小复现：`node verify/cdp.mjs --url <base> --dump-dom`

#### ✅ BUNDLE-2 — HTTP 直取组合 bundle：内容确为 meow-smooth 的 ModuleLoader 注册

**状态：PASS**

证据：

```
GET plugins/??@deepseek-ai/dsh-client-ui-trajectory/client.js,meow-smooth/client.js,@deepseek-ai/dsh-api-remote-access/client.js,@deepseek-ai/dsh-session-log-export… → HTTP 200，2082496 bytes；含 __ModuleLoader__.load 且 id "meow-smooth"=true
片段：
ct = inject;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
  id: "meow-smooth",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getO
```
最小复现：`curl -b c.txt "<base>/plugins/??…,meow-smooth/client.js,…" | grep -n 'meow-smooth'`

## 17899 / 插件行为实测

#### ✅ BEHAV-1 — 移动视口：输入多行→失焦，[data-input-scroll] 被压到 1 行（1 行 = line-height×1 + padding）

**状态：PASS**

证据：

```
初始：attr=collapsed, scrollClientH=24
真实触屏点输入框后：activeElement 命中 [data-composer-input]=true, 折叠属性=null（null=已展开）, scrollClientH=52（展开判定 OK）
注入 8 行文本：ok=true，textLen=44, scrollScrollH=196（内容确实多行增长）
点卡片外失焦后：attr=collapsed, --meow-smooth-fold-height=24px, scrollClientH=24, 期望 1 行=24（line-height 24 + padding 0，容差 ±3）
foldTrace: ["74922 pd ta ae=BODY","74922 exp! ae=BODY","74927 os-ts chain=0 excl=false tgt=DIV ae=BODY","75007 fi ae=DIV len=0","76018 bei insertText ae=DIV len=0","77029 os-ts chain=0 excl=false tgt=DIV ae=DIV len=44","77102 fo ae=BODY","77103 cld ae=BODY"]
```
截图：

![BEHAV-1](verify/shots/17899-mobile-typed.png)
![BEHAV-1](verify/shots/17899-mobile-folded.png)

最小复现：`node verify/run-all.mjs --only BEHAV-1（可加 --shots 看截图）`

#### ✅ BEHAV-3 — host 轮询活着：7.5s 窗口内 /plugins/meow-smooth/pending 请求 ≥2 次（插件 3s 间隔）

**状态：PASS**

证据：

```
窗口 7.5s：GET /plugins/meow-smooth/pending × 3；/diag-log × 0；窗口内全部插件路由=["pending"]
```
最小复现：`node verify/run-all.mjs --only BEHAV-3`

#### ✅ BEHAV-4 — 提醒卡片节点已挂载且与 host 空态一致（有 pending 时的展开渲染无法自动断言）

**状态：PASS**

证据：

```
div[data-meow-smooth-pending] 存在=true；实测={"visible":null,"mode":null,"text":"","rect":{"w":0,"h":0},"display":"none","opacity":"1"}
host GET /pending 空态=是：{"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}
说明：「有真实未决审批/提问时卡片展开、按钮可跳转」受限于无模型凭证造不出 pending，无法自动断言（见报告末节手工步骤）。
```
最小复现：`node verify/run-all.mjs --only BEHAV-4`

#### ✅ BEHAV-5 — 移动视口：窄屏展开侧栏 → 切换会话（新建/点其他会话行）自动收起，并打上插件私有 furl 标记

**状态：PASS**

证据：

```
点 [data-meow-smooth-fab] 展开：collapsed=false, furl=null；会话行数=1（[data-row-key^="session:"]）
点上游列表内 "New Session" 触发会话切换：选中会话 session:session-a0c6ef9f-48f6-4a2d-b1af-0ac07b49ea4e → session:session-fb0bd16f-3641-415e-ae9b-4ee446678884
切换后 209ms 内：collapsed=true, furl=true（期望 true/true）
重挂探针：切换前打在 composer 上的 __verifyMark 切换后=null（null=子树已重挂，插件"会话切换会重挂"前提成立；此时 hook 本该触发）
未选中会话行=["New Session(sel=true)"]（无可点行）
本轮被测 client bundle rev=bff89162f8bb（lib/client.js 构建时间见报告顶部快照）
归属说明：data-meow-smooth-furled 是插件私有标记（上游不写）→ 收起只能由插件触发；上游只在页面加载时按断点收起一次。
【A/B 对照证据（本轮适配期间实测；同一 host 进程 15:51 启动后未重启、同一 dsh 0.2.1-rc.2，唯一变量是插件构建）】
- 旧构建 rev=d3a414f0ae89（lib/ 15:50 构建，16:07 观测）：展开侧栏 → 点 New Session → collapsed=true, furl=true ✅ 收起成立
- 新构建 rev=7eeeced156fd（lib/client.js 16:12:40 构建，本断言复现）：同操作 → collapsed=false, furl=null ❌ 一直不收
判定：插件侧**回归**（非上游行为变化）。上游未变；且重挂探针证明"会话切换会重挂 composer 子树"这一插件依赖的前提成立，hook 本该触发。
```
截图：

![BEHAV-5](verify/shots/17899-mobile-sidebar.png)

最小复现：`node verify/run-all.mjs --only BEHAV-5`

#### ✅ BEHAV-6 — 移动视口：composer 按钮行单行不换行（flex-wrap:nowrap + 子元素同一视觉行）

**状态：PASS**

证据：

```
uV2eYG_row: flexWrap=nowrap, rowH=42, 子元素 top 跨度=3px, kids=["uV2eYG_tools@492","uV2eYG_trailing@489"]
```
最小复现：`node verify/run-all.mjs --only BEHAV-6`

#### ✅ BEHAV-7 — 移动视口：设置浮层全窗口铺满 + 插件状态机属性 data-meow-smooth-settings=collapsed

**状态：PASS**

证据：

```
面板 rect={"x":0,"y":0,"w":390,"h":844} vs viewport 390×844（铺满=true）；属性=collapsed；含 nav=true
```
截图：

![BEHAV-7](verify/shots/17899-mobile-settings.png)

最小复现：`node verify/run-all.mjs --only BEHAV-7`

#### ✅ BEHAV-2 — 桌面视口：输入多行→失焦压到 2 行（与窄屏 1 行区分）

**状态：PASS**

证据：

```
初始 scrollClientH=52, attr=null
注入 7 行文本 ok=true，textLen=20, scrollScrollH=172
失焦后 attr=collapsed, --meow-smooth-fold-height=48px, scrollClientH=48, 期望 2 行=48（line-height 24，容差 ±3）
```
截图：

![BEHAV-2](verify/shots/17899-desktop-typed.png)
![BEHAV-2](verify/shots/17899-desktop-folded.png)

最小复现：`node verify/run-all.mjs --only BEHAV-2`

#### ✅ BEHAV-6d — 桌面视口：composer 按钮行同样单行不换行

**状态：PASS**

证据：

```
uV2eYG_row: flexWrap=nowrap, rowH=42, top 跨度=3px
```
最小复现：`node verify/run-all.mjs --only BEHAV-6d`

## 17899 / 环境稳定性

#### ✅ ENV-1 — 实例在跑批期间未被重启 / 未掉线（换 DSH_HOME 也算）

**状态：PASS**

证据：

```
起始/结束指纹一致：{"pendingStatus":200,"hostVersion":"0.8.2","bootToken":"ESRmjeWD01YjLCYoCGMoCU_fPbFxQgH9AzCqaSt9TMQ","error":null}（/pending=200, hostVersion=0.8.2）
```
最小复现：`确认实例未被重启后重跑：node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log`

# 【实例 17900】

## 17900 / host 路由

#### ✅ HOST-1 — GET /plugins/meow-smooth/pending 带 cookie → 200 + JSON 结构（hostVersion/approvals/questions/events）

**状态：PASS**

证据：

```
HTTP 200；body={"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}；缺字段=[]
```
最小复现：`先 curl -c c.txt "http://127.0.0.1:17900/?token=P0pO7a3B-epG2T5VfyHvfu0lUhbK-gwGShsOVxntfrc"，再 curl -b c.txt "http://127.0.0.1:17900/plugins/meow-smooth/pending"`

#### ✅ HOST-2 — 无 cookie 访问 /pending 被鉴权挡住（401）

**状态：PASS**

证据：

```
HTTP 401；body=unauthorized
```
最小复现：`curl -i "http://127.0.0.1:17900/plugins/meow-smooth/pending"（不带 cookie）`

#### ✅ HOST-3 — PWA 静态资源路由仍在（manifest.json 200 + JSON）

**状态：PASS**

证据：

```
HTTP 200；body={"id":"/","name":"dsh meow","short_name":"dsh","display":"standalone","start_url":"/","scope":"/","background_color":"#312E81","theme_color":"#4F46E5","icons":[{"src":"/plugins/meow-smooth/icon-180.pn
```
最小复现：`curl -b c.txt "http://127.0.0.1:17900/plugins/meow-smooth/manifest.json"`

## 17900 / DOM 锚点契约

#### ✅ STATIC-1 — 上游 bundle 仍提供插件依赖的 DOM 锚点（防上游改名的静默失效）

**状态：PASS**

证据：

```
抓取 shell + 3 个 combo bundle，共 15133111 字节；逐锚点命中：
- data-composer-card: ✅ 在上游 bundle 中
- data-input-scroll: ✅ 在上游 bundle 中
- data-composer-input: ✅ 在上游 bundle 中
- data-sidebar-collapsed: ✅ 在上游 bundle 中
- data-sidebar-right-panel: ✅ 在上游 bundle 中
- data-sidebar-right-open: ✅ 在上游 bundle 中
- data-slot: ✅ 在上游 bundle 中
- data-row-key: ✅ 在上游 bundle 中
- data-question-key: ✅ 在上游 bundle 中
- data-approval-key: ✅ 在上游 bundle 中
- data-plan-review-key: ✅ 在上游 bundle 中
meow client rev=30c9aa7fd22e
```
最小复现：`node verify/run-all.mjs --only STATIC-1`

#### ✅ ANCHOR-1 — 核心 composer / 侧栏锚点存在

**状态：PASS**

证据：

```
[data-composer-card]: true
[data-input-scroll]: true
[data-composer-input]: true
[data-sidebar-right-panel]: true
```
最小复现：`node verify/cdp.mjs --url <base> --selectors "[data-composer-card],[data-input-scroll],[data-composer-input],[data-sidebar-right-panel]"`

#### ✅ ANCHOR-2 — 消息操作行 / 侧边栏折叠锚点

**状态：PASS**

证据：

```
[data-sidebar-collapsed]=true（窄屏默认收起态由上游渲染）；消息操作行=false（空会话无消息时上游不渲染，属正常）
```
最小复现：`在移动视口打开一个已有消息的会话后复查 [data-slot="message.actions"]`

#### ⚪ ANCHOR-3 — pending 交互锚点 [data-question-key]/[data-approval-key]

**状态：N/A**

证据：

```
无法自动断言：测试 home 无模型凭证（.credentials.yaml 只有 browser-session grant），无法驱动真实 agent 轮次造出 pending question/approval。
当前页面：questionKey=false, approvalKey=false（无 pending 时上游本就不渲染，非缺陷）。
替代证据见 STATIC-1（上游 bundle 仍提供这两个锚点）+ 手工复现步骤见报告末节。
```
最小复现：`手工：在 17899/17900 打开一个会话 → 发一条会触发提问的消息（如要求 agent 用 ask_user_question 提问）→ 面板出现后查 [data-question-key]；审批同理用会触发审批的工具。`

#### ✅ ANCHOR-4 — 桌面视口：侧栏展开（上游不受插件窄屏逻辑干预）+ 锚点齐全

**状态：PASS**

证据：

```
collapsed=false（桌面应为 false=展开）、furl=null（桌面应为 null=未 furl）、composer/scroll/rightPanel=true/true/true
```
最小复现：`node verify/cdp.mjs --url <base> --viewport desktop --dump-dom`

## 17900 / 页面运行时

#### ✅ PAGE-1 — 移动视口整轮无 pageerror（插件脚本硬故障的第一信号）

**状态：PASS**

证据：

```
Runtime.exceptionThrown=0；注入式早鸟 window.__verifyErrors 中 error 类 0 条；Network.loadingFailed=2
```
截图：

![PAGE-1](verify/shots/17900-mobile-initial.png)

#### ✅ PAGE-2 — 无 unhandledrejection（未捕获 promise 拒绝）

**状态：PASS**

证据：

```
unhandledrejection=0
```
最小复现：`node verify/run-all.mjs --only PAGE-2`

#### ✅ PAGE-3 — 被测实例同源资源无失败请求 / 无 4xx-5xx

**状态：PASS**

证据：

```
同源 loadingFailed=0；同源 HTTP 错误=0（含 /plugins/meow-smooth/* 全部 200）
另有第三方（非被测实例）资源失败 4 条，与 meow-smooth 无关，仅备案：[{"url":"https://dsh-market.com/api/telemetry/event","error":"net::ERR_FAILED","type":"Fetch","canceled":false},{"url":"https://dsh-market.com/api/telemetry/event","error":"net::ERR_FAILED","type":"Fetch","canceled":false},{"url":"https://dsh-market.com/api/telemetry/event","status":403},{"url":"https://dsh-market.com/api/telemetry/event","status":403}]
```
最小复现：`node verify/run-all.mjs --only PAGE-3`

#### ✅ PAGE-4 — 桌面视口无 pageerror / unhandledrejection

**状态：PASS**

证据：

```
Runtime.exceptionThrown=0；早鸟捕获=0
```
最小复现：`node verify/run-all.mjs --only PAGE-4`

## 17900 / client bundle 加载

#### ✅ BUNDLE-1 — shell 组合 URL 包含并成功加载 meow-smooth/client.js

**状态：PASS**

证据：

```
resource timing 命中 1 条：
- http://127.0.0.1:17900/plugins/??@deepseek-ai/dsh-experimental-client-ui-agent-team/client.js,@linxin666/dsh-client-ui-git-graph/client.js,@weibaohui/skills-management/client.js,@deepseek-ai/dsh-api-r…
```
最小复现：`node verify/cdp.mjs --url <base> --token <t> --eval "performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/meow-smooth/.test(n))"`

#### ✅ BUNDLE-3 — 插件注入的三张样式表都在 DOM（fold / gesture / settings）

**状态：PASS**

证据：

```
style[data-plugin="meow-smooth"] = [fold-css, settings-css, gesture-css]
```
最小复现：`document.querySelectorAll('style[data-plugin="meow-smooth"]')`

#### ✅ BUNDLE-4 — 插件运行时产物存在（html 标记 + FAB + pending 条 + dispose 钩子）

**状态：PASS**

证据：

```
html[data-meow-smooth-gesture-loaded]=true，html[data-meow-apply-stage]=true
button[data-meow-smooth-fab]=true，div[data-meow-smooth-pending]=true
typeof window.__meowSmoothClientDispose=function
带 data-meow* 属性的节点 6 个：HTML[data-meow-apply-stage=suppressor-registered data-meow-smooth-gesture-loaded=v6.3-tap data-meow-smooth-furled=true] / STYLE[data-meow-fold-css=true data-meow-sheet-epoch=1 data-meow-sheet-born=1792990012346] / STYLE[data-meow-smooth-settings-css=true] / STYLE[data-meow-smooth-gesture-css=true] / BUTTON[data-meow-smooth-fab=true data-meow-h=40] / DIV[data-meow-smooth-pending=true]
```
最小复现：`node verify/cdp.mjs --url <base> --dump-dom`

#### ✅ BUNDLE-2 — HTTP 直取组合 bundle：内容确为 meow-smooth 的 ModuleLoader 注册

**状态：PASS**

证据：

```
GET plugins/??@deepseek-ai/dsh-experimental-client-ui-agent-team/client.js,@linxin666/dsh-client-ui-git-graph/client.js,@weibaohui/skills-management/client.js,@deep… → HTTP 200，4814327 bytes；含 __ModuleLoader__.load 且 id "meow-smooth"=true
片段：
name = name;
		return module.exports;
	}
});
;
window.__ModuleLoader__.load({
  id: "meow-smooth",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getO
```
最小复现：`curl -b c.txt "<base>/plugins/??…,meow-smooth/client.js,…" | grep -n 'meow-smooth'`

## 17900 / 插件行为实测

#### ✅ BEHAV-1 — 移动视口：输入多行→失焦，[data-input-scroll] 被压到 1 行（1 行 = line-height×1 + padding）

**状态：PASS**

证据：

```
初始：attr=null, scrollClientH=52
真实触屏点输入框后：activeElement 命中 [data-composer-input]=true, 折叠属性=null（null=已展开）, scrollClientH=52（展开判定 OK）
注入 8 行文本：ok=true，textLen=44, scrollScrollH=196（内容确实多行增长）
点卡片外失焦后：attr=collapsed, --meow-smooth-fold-height=24px, scrollClientH=24, 期望 1 行=24（line-height 24 + padding 0，容差 ±3）
foldTrace: ["13444 sel Caret ae=DIV len=0","18647 pd ta ae=BODY","18658 os-ts chain=0 excl=false tgt=DIV ae=BODY","18738 fi ae=DIV len=0","19763 bei insertText ae=DIV len=0","20788 os-ts chain=0 excl=false tgt=DIV ae=DIV len=44","20857 fo ae=BODY","20858 cld ae=BODY"]
```
截图：

![BEHAV-1](verify/shots/17900-mobile-typed.png)
![BEHAV-1](verify/shots/17900-mobile-folded.png)

最小复现：`node verify/run-all.mjs --only BEHAV-1（可加 --shots 看截图）`

#### ✅ BEHAV-3 — host 轮询活着：7.5s 窗口内 /plugins/meow-smooth/pending 请求 ≥2 次（插件 3s 间隔）

**状态：PASS**

证据：

```
窗口 7.5s：GET /plugins/meow-smooth/pending × 2；/diag-log × 0；窗口内全部插件路由=["pending"]
```
最小复现：`node verify/run-all.mjs --only BEHAV-3`

#### ✅ BEHAV-4 — 提醒卡片节点已挂载且与 host 空态一致（有 pending 时的展开渲染无法自动断言）

**状态：PASS**

证据：

```
div[data-meow-smooth-pending] 存在=true；实测={"visible":null,"mode":null,"text":"","rect":{"w":0,"h":0},"display":"none","opacity":"1"}
host GET /pending 空态=是：{"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}
说明：「有真实未决审批/提问时卡片展开、按钮可跳转」受限于无模型凭证造不出 pending，无法自动断言（见报告末节手工步骤）。
```
最小复现：`node verify/run-all.mjs --only BEHAV-4`

#### ✅ BEHAV-5 — 移动视口：窄屏展开侧栏 → 切换会话（新建/点其他会话行）自动收起，并打上插件私有 furl 标记

**状态：PASS**

证据：

```
点 [data-meow-smooth-fab] 展开：collapsed=false, furl=null；会话行数=1（[data-row-key^="session:"]）
点上游列表内 "New Session" 触发会话切换：选中会话 session:session-d1cd8907-9d44-461a-9832-3c27b5e7216f → session:session-91f8f5a6-a968-458d-ade3-5b499fa38328
切换后 230ms 内：collapsed=true, furl=true（期望 true/true）
重挂探针：切换前打在 composer 上的 __verifyMark 切换后=null（null=子树已重挂，插件"会话切换会重挂"前提成立；此时 hook 本该触发）
未选中会话行=["New Session(sel=true)"]（无可点行）
本轮被测 client bundle rev=2bc9c680d6e6（lib/client.js 构建时间见报告顶部快照）
归属说明：data-meow-smooth-furled 是插件私有标记（上游不写）→ 收起只能由插件触发；上游只在页面加载时按断点收起一次。
【A/B 对照证据（本轮适配期间实测；同一 host 进程 15:51 启动后未重启、同一 dsh 0.2.1-rc.2，唯一变量是插件构建）】
- 旧构建 rev=d3a414f0ae89（lib/ 15:50 构建，16:07 观测）：展开侧栏 → 点 New Session → collapsed=true, furl=true ✅ 收起成立
- 新构建 rev=7eeeced156fd（lib/client.js 16:12:40 构建，本断言复现）：同操作 → collapsed=false, furl=null ❌ 一直不收
判定：插件侧**回归**（非上游行为变化）。上游未变；且重挂探针证明"会话切换会重挂 composer 子树"这一插件依赖的前提成立，hook 本该触发。
```
截图：

![BEHAV-5](verify/shots/17900-mobile-sidebar.png)

最小复现：`node verify/run-all.mjs --only BEHAV-5`

#### ✅ BEHAV-6 — 移动视口：composer 按钮行单行不换行（flex-wrap:nowrap + 子元素同一视觉行）

**状态：PASS**

证据：

```
uV2eYG_row: flexWrap=nowrap, rowH=42, 子元素 top 跨度=3px, kids=["uV2eYG_tools@492","uV2eYG_trailing@489"]
```
最小复现：`node verify/run-all.mjs --only BEHAV-6`

#### ✅ BEHAV-7 — 移动视口：设置浮层全窗口铺满 + 插件状态机属性 data-meow-smooth-settings=collapsed

**状态：PASS**

证据：

```
面板 rect={"x":0,"y":0,"w":390,"h":844} vs viewport 390×844（铺满=true）；属性=collapsed；含 nav=true
```
截图：

![BEHAV-7](verify/shots/17900-mobile-settings.png)

最小复现：`node verify/run-all.mjs --only BEHAV-7`

#### ✅ BEHAV-2 — 桌面视口：输入多行→失焦压到 2 行（与窄屏 1 行区分）

**状态：PASS**

证据：

```
初始 scrollClientH=52, attr=null
注入 7 行文本 ok=true，textLen=20, scrollScrollH=172
失焦后 attr=collapsed, --meow-smooth-fold-height=48px, scrollClientH=48, 期望 2 行=48（line-height 24，容差 ±3）
```
截图：

![BEHAV-2](verify/shots/17900-desktop-typed.png)
![BEHAV-2](verify/shots/17900-desktop-folded.png)

最小复现：`node verify/run-all.mjs --only BEHAV-2`

#### ✅ BEHAV-6d — 桌面视口：composer 按钮行同样单行不换行

**状态：PASS**

证据：

```
uV2eYG_row: flexWrap=nowrap, rowH=42, top 跨度=3px
```
最小复现：`node verify/run-all.mjs --only BEHAV-6d`

## 17900 / 环境稳定性

#### ✅ ENV-1 — 实例在跑批期间未被重启 / 未掉线（换 DSH_HOME 也算）

**状态：PASS**

证据：

```
起始/结束指纹一致：{"pendingStatus":200,"hostVersion":"0.8.2","bootToken":"P0pO7a3B-epG2T5VfyHvfu0lUhbK-gwGShsOVxntfrc","error":null}（/pending=200, hostVersion=0.8.2）
```
最小复现：`确认实例未被重启后重跑：node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log`

## 「插件 bug」vs「上游 dsh 行为变化」判定口径

| 现象 | 判定为 | 依据 |
| --- | --- | --- |
| 插件注入的标记（`data-meow-*`）/私有属性缺失、pageerror 栈落在插件模块 | **插件 bug** | 产物是插件自己写的；上游不会写 `data-meow-*` |
| 上游锚点（`data-composer-card` 等）在 bundle 里改名/消失，插件选择器落空 | **上游行为变化** | STATIC-1 直接从上游 bundle 取证 |
| 插件行为属性在（如 furl=true）但布局没变 | **插件 bug（选择器/时机）** | 属性写入 ≠ 生效，需比对几何 |
| 下游动作由上游自己完成（如窄屏加载即收起）| 需与插件归因区分 | 插件私有 furl 标记只此一家 |

## 官方已自带 / 插件应让位的功能（0.2.1-rc.2 实测）

| 能力 | 上游 0.2.1-rc.2 现状 | 插件现状 | 建议 |
| --- | --- | --- | --- |
| 首次运行引导模态（Preview Notice / Get started）| 上游自带，且盖住 composer | 插件不干预 | 无关，仅影响自动化需先关掉 |
| 窄屏默认收起侧边栏 | 上游按断点自带（加载即 `data-sidebar-collapsed`）| 插件补「切会话自动收起 + furl 小方块」 | 保留增量部分（见 BEHAV-5 归属说明）|
| composer 折叠 1/2 行 | 上游无（0.2.1 输入框自由增高）| 插件 JS+CSS 实现 | 插件价值明确，保留 |
| 设置面板移动端布局 | 上游未全窗口化 | 插件补全屏 + 边栏折叠态机 | 保留 |

## 无法自动断言项 + 手工复现步骤

1. **真实 pending 审批/提问下的提醒卡片与 `[data-question-key]`/`[data-approval-key]` 面板**
   - 原因：测试 home（`/tmp/dsh-test-home`、`/tmp/dshmirror`）无模型凭证，造不出真实 pending。
   - 手工：打开实例 → 会话内发一条要求 agent 提问的消息 → 面板出现后执行 `document.querySelectorAll('[data-question-key],[data-approval-key]').length`；同时看 `div[data-meow-smooth-pending]` 是否 `data-visible="true"` 且可点击跳转。
   - 替代证据：STATIC-1 证明上游锚点仍在；BEHAV-3/4 证明轮询与卡片节点活着。
2. **键盘（IME）弹起相关行为**（header 收起、悬浮条、Enter 插入换行）
   - 原因：headless 无真实软键盘，`visualViewport` 不会因键盘缩高。
   - 手工：手机浏览器打开实例，点输入框弹键盘，观察 header 是否被悬浮条替代。
3. **触屏手势**（边缘滑出侧栏、右栏分屏拖拽、双击缩放等）
   - 原因：CDP 合成 touch 序列难以稳定复现多指/惯性/长按时序。
   - 手工：真机或 DevTools 设备模拟里逐项目测；或复跑仓库内既有 `scripts/probe-*.mjs`、`scripts/e2e-*.mjs`。
4. **PWA / Service Worker 通知**（`sw.js`、push 订阅、通知点击跳会话）
   - 原因：headless 无 Web Push 端点，通知权限也无法交互授予。
   - 手工：Chrome 打开实例 → 允许通知 → 触发一次完成事件看系统通知。

## 最终验收：一条命令

```bash
# 前置（每轮必做）：src/ 有改动 → 重建；host 侧改动 → 重启实例；client 侧改动只需重建 + 刷新
cd /root/ws/meow-smooth && node build.mjs

# 17899 精简组合（Lead 启动：cd /tmp && DSH_HOME=/tmp/dsh-test-home nohup dsh --profile meowtest --port 17899 --no-open > /tmp/meowtest-boot.log 2>&1 &）
# 17900 真实组合镜像由 Lead 统一拉起后再纳入本命令（token 现从 /tmp/dshmirror-boot.log 读）

node /root/ws/meow-smooth/verify/run-all.mjs \
  --target 17899=/tmp/meowtest-boot.log \
  --target 17900=/tmp/dshmirror-boot.log \
  --out /root/ws/meow-smooth/verify/report.md
```

| 场景 | 命令 |
| --- | --- |
| 全量（两实例 × 移动+桌面） | 上面那条 |
| 只跑 17899 | `node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log` |
| 只跑单条断言（调试） | `node verify/run-all.mjs --only BEHAV-5` |
| 只跑桌面视口（省内存） | `node verify/run-all.mjs --phase desktop --only PAGE-4,BEHAV-2,ANCHOR-4,BEHAV-6d` |
| 只重渲染报告（零浏览器） | `node verify/run-all.mjs --from-raw verify/raw/results.json` |

### 资源预算与稳定性（本机 cgroup 4GB、无 swap、同机还有 live GUI）

- 整轮**只起一个 chromium**，移动轮跑完切视口 + 重载页面继续桌面轮，跑完立刻 `Browser.close` + 杀进程组（`verify/cdp.mjs` 里 `launchChromium/close`）；
- 启动参数带省内存项：`--disable-dev-shm-usage --js-flags=--max-old-space-size=256 --renderer-process-limit=2 --disable-extensions --disable-background-networking`；
- **同一时刻只跑一个 chromium**（和队友串行安排），否则会被内核 global OOM 杀掉；
- 每轮干净 profile，开头自动过掉上游引导模态（Preview Notice / Get started）；所有交互用真实 touch/mouse 事件（不是 `element.click()`——插件的程序化聚焦抑制器会识别并撤焦）；断言之间互不影响，单条断言失败不会打断整轮。

---

# 旧版不回归冒烟（dsh 0.1.5-rc.1）

> 本节由 verifier 手工并入（该轮为**子集验收，不是全量**）。工具与断言实现未变，只是把"composer 不可编辑"这类**版本/环境差异**正确记为 N/A 而不是 FAIL。

## 冒烟环境

| 项目 | 值 |
| --- | --- |
| 实例 | `http://127.0.0.1:17901`（`DSH_HOME=/tmp/dsh015-home`，profile `legacyweb`，dsh **0.1.5-rc.1** 隔离安装 `/tmp/dsh015`） |
| 插件 | 同一份**冻结构建**（`lib/client.js` sha256[0:16] `f036a03d0e7bd6c3`、`lib/index.js` `31b31f6023adc624`、package.json `0.8.2`）以 `link:/root/ws/meow-smooth` 挂载 |
| 当轮 client bundle rev | `6f72fe36ecf46b0b-44`（0.1.5 的 rev 形如 `<hash>-<n>`；0.2.x 为 12 位 hex） |
| host 路由 | 无 cookie `/plugins/meow-smooth/pending` → **401**；带 cookie → **200** `{"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}` |
| 复跑命令 | `node verify/run-all.mjs --phase mobile --only PAGE-1,PAGE-2,BUNDLE-4,ANCHOR-1,BEHAV-1 --target 17901=/tmp/dsh015-boot.log --out verify/raw/report-17901-smoke.md` |
| 原始数据 | `verify/raw/results-17901-smoke.json` |

## 结果：6 PASS / 0 FAIL / 1 N-A

| 断言 | 结果 | 证据摘要 |
| --- | --- | --- |
| PAGE-1 移动视口无 pageerror | ✅ PASS | `Runtime.exceptionThrown=0`，注入式早鸟 `__verifyErrors` 中 error 类 0 条（插件在 0.1.5 上加载运行未抛错） |
| PAGE-2 无 unhandledrejection | ✅ PASS | 未捕获 promise 拒绝 0 条 |
| PAGE-3 同源资源无失败请求 | ✅ PASS | 同源 `loadingFailed=0`、无 4xx-5xx（0.1.5 上游把插件的 dev-time 桥接请求都处理掉了，无 404 噪声） |
| BUNDLE-4 插件运行时产物存在 | ✅ PASS | `html[data-meow-smooth-gesture-loaded]`/`[data-meow-apply-stage]`、`button[data-meow-smooth-fab]`、`div[data-meow-smooth-pending]`、`typeof window.__meowSmoothClientDispose === 'function'`，共 7 个 `data-meow*` 节点 + 三张注入样式表 |
| ANCHOR-1 核心 composer 锚点 | ✅ PASS | 硬要求 `[data-composer-card]`/`[data-input-scroll]`/`[data-composer-input]` 全在；`[data-sidebar-right-panel]`/`[data-sidebar-right-open]` 缺失（见差异 ①） |
| BEHAV-1 移动端多行→失焦折叠 1 行 | ⚪ N/A | 上游把 composer 渲染成**不可编辑**：`{"tag":"DIV","isCE":false,"ceAttr":"false","taCount":0}`，点 `[data-input-scroll]` 后 `activeElement=BODY` → "输入多行→失焦折叠"无从实测（**不代表折叠失效**） |
| ENV-1 实例跑批期间稳定 | ✅ PASS | 跑批前后指纹一致（`/pending`=200、hostVersion `0.8.2`、boot-log token 不变） |

## 与 0.2.1-rc.2 的实测差异（差异 ≠ 回归）

① **右栏锚点**：`[data-sidebar-right-panel]` / `[data-sidebar-right-open]` 在 0.1.5 不存在（上游 0.2.x 才引入右侧栏）。
→ 验证台据此把 ANCHOR-1 改为"硬要求 composer 三锚点 + 右栏锚点记为观察项"，避免旧版缺上游新元素被误判成插件回归。

② **composer 可编辑性**：0.2.1-rc.2 的 `[data-composer-input]` 是 Lexical `contenteditable=true`；0.1.5 同一锚点是 `contenteditable="false"`、页面无 `textarea`、点击不聚焦。
→ 归因证据在 **0.1.5 自己的产物**里：`…/@deepseek-ai+dsh-client-ui-conversation@0.1.5-rc.3/…/lib/client.js` 中该属性由 `contentEditable: editor !== null && editable` 决定，即**上游编辑器未挂载/不可编辑状态**，与插件无关（插件只读 `[data-composer-input]`/`textarea`，不设置 `contenteditable`）。
→ 因此 BEHAV-1 在该实例上记 **N/A**（附原因），而不是 FAIL；验证台已把这条判定固化进断言（先探测 `isContentEditable`/`textarea`，不可编辑则 N/A）。

③ **一致的部分**：host 路由与鉴权语义（401/200 + `hostVersion`）、client bundle 注入方式、`data-meow-*` 产物集合、无 pageerror —— 0.1.5 与 0.2.1 表现一致，**未观察到旧版回归**。

## 限定（重要）

- 本节只跑**移动视口** + 上述断言子集（其中 PAGE-3/ENV-1 由断言实现自动带出）；**桌面视口、折叠 2 行、切会话收起侧栏、按钮行不换行、设置页全屏、host 轮询窗口等未在 0.1.5 上验证**。
- 因此结论只能表述为"**0.1.5 上无硬故障（无 pageerror / 产物齐全 / host 路由正常），折叠类行为因上游 composer 不可编辑无法实测**"，不能表述为"0.1.5 全量验收通过"。
- 环境插曲（记录用，非插件问题）：0.1.5 的 `patchReload: "live"` 需要 Cordis HMR 服务，隔离安装里没有 → 启动直接抛错；改为 `"startup"` 后才能起。
