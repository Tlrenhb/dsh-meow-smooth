# verify/ — meow-smooth × dsh 0.2.1-rc.2 验证台

本目录是 task-3（verifier）的交付物：**可复现的端到端证据**。不依赖 puppeteer/playwright，只用
node ≥ 22 自带的全局 `WebSocket` 手写 CDP 客户端驱动 `/usr/bin/chromium`。

| 文件 | 作用 |
| --- | --- |
| `cdp.mjs` | 可复用 CDP 探针：启动/连接 chromium、移动(390×844, touch, dsf2)/桌面(1440×900) 视口、token 鉴权、console/pageerror/requestfailed 采集、真实 touch/mouse 输入、DOM 断言原语、截图。也可当 CLI 单跑（见文件头注释）。 |
| `run-all.mjs` | 一键跑全部断言 → 输出 `report.md`（每条 PASS/FAIL/N-A + 证据片段 + 截图 + 最小复现步骤）、`raw/results.json`（原始观测）。 |
| `report.md` | 验证报告（按实例分栏 + 断言×实例矩阵）。 |
| `shots/` | 每条断言的截图证据。 |
| `raw/results.json` | 原始数据；`--from-raw` 可零浏览器重渲染报告。 |

## 一条命令（最终验收）

```bash
cd /root/ws/meow-smooth && node build.mjs          # 前置：src 有改动必须重建
node verify/run-all.mjs \
  --target 17899=/tmp/meowtest-boot.log \
  --target 17900=/tmp/dshmirror-boot.log           # 17900 由 Lead 统一拉起
```

常用变体：

| 场景 | 命令 |
| --- | --- |
| 只跑 17899 | `node verify/run-all.mjs --target 17899=/tmp/meowtest-boot.log` |
| 单条断言 | `node verify/run-all.mjs --only BEHAV-5` |
| 只跑桌面视口（省内存） | `node verify/run-all.mjs --phase desktop --only PAGE-4,BEHAV-2,ANCHOR-4,BEHAV-6d` |
| 只重渲染报告 | `node verify/run-all.mjs --from-raw verify/raw/results.json` |
| 临时实例 | `node verify/run-all.mjs --base http://127.0.0.1:17899 --token <t> --label 临时` |

## 复跑前提（每轮必做）

- **src/ 有改动 → `node build.mjs`**，否则测的是旧 bundle（报告顶部会打印 `lib/`+`src/` 的 mtime/sha256 快照，可对照）。
- **host 侧改动 → 重启实例**；**client 侧改动只需重建 + 刷新页面**（实测：host 每请求现算 bundle rev，重建后 rev 变化即被加载）。
- 实例 token 每轮从启动日志现读（`/tmp/meowtest-boot.log`、`/tmp/dshmirror-boot.log`），不要复用旧 token。

## 资源预算（本机 cgroup 4GB、无 swap、同机还有 live GUI）

- 整轮**只起一个 chromium**：移动轮跑完切视口 + 重载页面继续桌面轮，跑完立刻 `Browser.close` + 杀进程组。
- 省内存启动参数：`--disable-dev-shm-usage --js-flags=--max-old-space-size=256 --renderer-process-limit=2 --disable-extensions --disable-background-networking`。
- **同一时刻全队只跑一个 chromium**，否则会被内核 global OOM 杀掉（`dmesg` 可见 `Killed process ... node-MainThread`）。
- 若脚本被强杀，`cdp.mjs` 的 `exit/SIGINT/SIGTERM` 钩子会兜底杀掉自己起的浏览器；仍残留时可 `pkill -f 'meow-verify-chro[m]e-'`。

## 复现性（已实测）

同一条合并命令连跑两次（2026-10-26 04:47 / 04:50，冻结构建 `lib/client.js` sha256[0:16] `f036a03d0e7bd6c3`）：

| 轮次 | 结果 | 原始数据 |
| --- | --- | --- |
| run1 | 17899: 24 PASS / 0 FAIL / 1 N-A；17900: 24 PASS / 0 FAIL / 1 N-A | `raw/results-combined-run1.json` |
| run2 | 同上，**50 条断言状态逐条一致** | `raw/results.json` |

两次都：单 chromium、~80s、跑完 0 残留进程、ENV-1（实例未重启）PASS。

## 旧版不回归冒烟（dsh 0.1.5-rc.1）

```bash
node verify/run-all.mjs --phase mobile --only PAGE-1,PAGE-2,BUNDLE-4,ANCHOR-1,BEHAV-1 \
  --target 17901=/tmp/dsh015-boot.log --out verify/raw/report-17901-smoke.md
```

结果：**6 PASS / 0 FAIL / 1 N/A**（`verify/raw/results-17901-smoke.json`；报告 `verify/report.md` 文末「旧版不回归冒烟」一节）。
要点：这是**子集验收**（只移动视口），不能当成"0.1.5 全量通过"。

两个**版本差异**（不是回归），验证台已内置处理：

| 差异 | 0.1.5-rc.1 实测 | 验证台行为 |
| --- | --- | --- |
| 右栏锚点 | `[data-sidebar-right-panel]`/`[data-sidebar-right-open]` 不存在（上游 0.2.x 才引入） | ANCHOR-1 只把 composer 三锚点当硬要求，右栏锚点降级为"观察项" |
| composer 可编辑性 | `[data-composer-input]` 是 `contenteditable="false"`、无 textarea、点击后 `activeElement=BODY`（0.1.5 自身 bundle：`contentEditable: editor !== null && editable`） | BEHAV-1/2 先探测可编辑性，不可编辑则记 **N/A + 原因**，不记 FAIL |

## 断言目录

| 组 | 断言 |
| --- | --- |
| host 路由 | HOST-1 `/plugins/meow-smooth/pending` 带 cookie 200 + JSON 结构；HOST-2 无 cookie 401；HOST-3 manifest.json 200 |
| 页面运行时 | PAGE-1/2 移动轮无 pageerror / 无 unhandledrejection；PAGE-3 同源资源无失败请求（第三方噪声只备案）；PAGE-4 桌面轮同上 |
| client bundle 加载 | BUNDLE-1 组合 URL 含并加载 `meow-smooth/client.js`；BUNDLE-2 HTTP 直取 bundle 验证确是 meow-smooth 的 `__ModuleLoader__.load` 注册；BUNDLE-3 三张注入样式表；BUNDLE-4 插件运行时产物（html 标记/FAB/pending 条/dispose 钩子） |
| DOM 锚点契约 | ANCHOR-1 核心 composer/侧栏锚点；ANCHOR-2 消息操作行/折叠锚点；ANCHOR-3 pending 交互锚点（N/A，见下）；ANCHOR-4 桌面视口；STATIC-1 从上游 bundle 静态抓取，验证插件依赖的锚点名仍由上游提供（防上游改名静默失效） |
| 插件行为实测 | BEHAV-1 移动端多行输入→失焦压到 1 行；BEHAV-2 桌面端压到 2 行；BEHAV-3 host 轮询活着（7.5s 窗口 ≥2 次）；BEHAV-4 提醒卡片节点与 host 空态一致；BEHAV-5 窄屏切会话自动收起（含 composer 重挂探针）；BEHAV-6/6d 按钮行不换行；BEHAV-7 设置页全屏 |

## 无法自动断言（报告里标 N/A + 手工步骤，不算 PASS）

1. **真实 pending 审批/提问**下的卡片展开与 `[data-question-key]`/`[data-approval-key]` 面板：测试 home 无模型凭证，造不出 pending。
2. **软键盘（IME）相关行为**：headless 无真实键盘，`visualViewport` 不会因键盘缩高。
3. **触屏手势**（边缘滑出、右栏分屏拖拽、双击缩放）：CDP 合成 touch 难稳定复现多指/惯性/长按时序。
4. **PWA / Service Worker 通知**：无 Web Push 端点、无法交互授予通知权限。

## 判定口径：插件 bug vs 上游行为变化

- 插件私有产物（`data-meow-*`、`style[data-plugin="meow-smooth"]`）缺失、pageerror 栈落在插件模块 → **插件 bug**；
- 上游锚点在上游 bundle 里改名/消失（STATIC-1 取证）→ **上游行为变化**；
- 插件属性写了但布局没动 → **插件 bug（选择器/时机）**；
- 对照实验原则：**同一 host 进程、同一 dsh 版本，只换插件构建** 得到的差异 = 插件侧回归（BEHAV-5 就是这样定性的）。

## 已知坑（写脚本时踩过，别再踩）

- `element.click()` / `element.focus()` **不算用户手势**：插件有"程序化聚焦抑制器"，会识别并撤焦；必须用 CDP 真实输入事件（触屏视口发 touch，桌面发 mouse）。
- 干净 chromium profile 每次都会重放上游引导模态（Preview Notice / Get started）盖住 composer → `dismissModals()` 必须先过一遍，且只点关闭/继续类按钮（绝不点 Add API Key / Sign in）。
- `Runtime.evaluate` 的表达式**漏写结尾 `()`** 会静默返回 `{}`（函数对象按值序列化）→ `cdp.mjs` 里已加防呆报错。
- CDP 命令都带超时（默认 25s）：渲染进程忙时 `Input.insertText` 可能超时 → `typeText()` 退化为 `{ok:false}` 让断言如实 FAIL，不打断整轮。
- 上游会话列表在"空会话"状态下只渲染当前那一个 session 行，所以"点其他会话行"路径不一定可用；切换用上游 "New Session" 按钮。