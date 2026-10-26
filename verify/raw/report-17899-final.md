# meow-smooth × dsh 0.2.1-rc.2 端到端验证报告

- 生成时间：2026-10-26T04:44:47.118Z（UTC）
- 生成者：verifier（task-3）；复跑命令：`node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log`
- 机器：linux x64 / node v25.6.0 / chromium Chromium 155.0.8059.39 built on Debian GNU/Linux 12 (bookworm)

## 结论摘要

> 数据来源：`verify/raw/results.json`（报告与它是同一次运行写出的；重渲染用 `--from-raw`）。

| 状态 | 条数 |
| --- | --- |
| ✅ PASS | 24 |
| ❌ FAIL | 0 |
| ⚪ 无法自动断言 (N/A) | 1 |

> 两栏口径：**17899 = 精简组合**（只有 dsh 本体 + meow-smooth，用于隔离插件自身行为）；
> **17900 = 真实组合镜像**（与用户 live web profile 同构：dshmarket / better-sidebar / free-search / model-extension / git-graph / skills-management + 修复版插件），用于确认没有组合冲突。

### 分实例小结

| 实例 | ✅ PASS | ❌ FAIL | ⚪ N/A |
| --- | --- | --- | --- |
| 17899 | 24 | 0 | 1 |

### 断言 × 实例 矩阵

| 断言 | 17899 |
| --- | --- |
| HOST-1 | ✅ |
| HOST-2 | ✅ |
| HOST-3 | ✅ |
| STATIC-1 | ✅ |
| PAGE-1 | ✅ |
| PAGE-2 | ✅ |
| PAGE-3 | ✅ |
| BUNDLE-1 | ✅ |
| BUNDLE-3 | ✅ |
| BUNDLE-4 | ✅ |
| ANCHOR-1 | ✅ |
| ANCHOR-2 | ✅ |
| ANCHOR-3 | ⚪ |
| BEHAV-1 | ✅ |
| BEHAV-3 | ✅ |
| BEHAV-4 | ✅ |
| BEHAV-5 | ✅ |
| BEHAV-6 | ✅ |
| BEHAV-7 | ✅ |
| BEHAV-2 | ✅ |
| PAGE-4 | ✅ |
| ANCHOR-4 | ✅ |
| BEHAV-6d | ✅ |
| ENV-1 | ✅ |
| BUNDLE-2 | ✅ |

**当前被测实例上：全部可自动断言项 PASS，无 pageerror，无插件硬故障。**

## 被测实例与环境

### 17899 — http://127.0.0.1:17899

- 启动 URL（本轮 token）：`http://127.0.0.1:17899/?token=ESRmjeWD01YjLCYoCGMoCU_fPbFxQgH9AzCqaSt9TMQ`
- 鉴权握手：HTTP 303 → ./，cookie=已获取
- /pending：HTTP 200 → `{"hostVersion":"0.8.2","approvals":[],"questions":[],"events":[]}`
- 上游锚点契约：combo bundle 3 个 / 12212523 字节；meow client rev=`30c9aa7fd22e`
- 引导模态处理（干净 profile 每次重放，必须过）：[{"head":"Preview Notice / DeepSeek Harness 0.2 is still in preview, and many areas need continued i","action":"clicked \"Continue\"","buttons":["Continue"]},{"head":"Preview Notice / DeepSeek Harness 0.2 is still in preview, and many areas need continued i","action":"clicked \"Continue\"","buttons":["Continue"]},{"head":"Preview Notice / DeepSeek Harness 0.2 is still in preview, and many areas need continued i","action":"clicked \"Continue\"","buttons":["Continue"]},{"head":"Get started / Sign in to your DeepSeek account or add an API Key to get started. Your proj","action":"clicked \"Close\"","buttons":["Close","Add API Key","Sign in"]}]
- 移动视口最终观测：furl=null，collapse=collapsed，插件样式=[fold-css, settings-css, gesture-css]
- 移动/桌面轮次 pageerror 数：0 / 0
- 本轮加载的 meow-smooth client bundle rev：`bff89162f8bb`

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
