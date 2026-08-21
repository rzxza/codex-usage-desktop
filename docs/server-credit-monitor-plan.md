# Codex Usage Desktop 改造设计文档
## Server Credit Monitor + Compact Monitor
### DSH 主实现 / Codex 独立审核监督工作流

**文档版本：** v0.1  
**日期：** 2026-08-21  
**上游项目：** `itvincent-git/codex-usage-desktop`  
**上游基线：** `main @ d7132dc79bd8b808c00309c8f9c9eed37b9a09a5`  
**目标平台（首版）：** Windows 10/11 x64  
**目标技术栈：** 保持上游 React 19 + Vite + Tauri 2 + Rust，不重写技术栈

---

## 0. 文档目的

本项目不从零开发新的 Codex 监控器，而是在现有 `codex-usage-desktop` 基础上 fork 并做增量改造。

首要目标不是建立一个“大而全”的分析平台，而是解决两个日常最有价值的问题：

1. **现在 Codex 5h / Weekly 额度还剩多少？**
2. **今天、最近 7 天实际大约消耗了多少 Server-derived Credits？**

现有项目负责的本地 Token、项目、模型、Session、预估 API Cost 等功能保留；新增“服务器额度/服务器 Credits”层，并增加一个适合长期驻留桌面的 Compact Monitor 小窗口。

项目采用双代理开发模式：

- **DSH（DeepSeek Harness + V4 Pro）：主实现者**
- **Codex：独立审核、监督、测试和发布 Gatekeeper**
- 两个代理不得默认互相代替角色；实现和审核应保持独立。

---

# 1. 项目定位

## 1.1 上游现有能力

上游已经具备：

- Windows / macOS 桌面应用
- React + Tauri + Rust
- 本地 `.codex` JSONL 扫描
- SQLite 本地索引
- Token / cache / model / project / session 统计
- 估算 API Cost
- 5 小时额度
- Weekly / Monthly 额度
- reset 时间
- 系统托盘
- 开机启动
- 中英文
- Excel / Markdown 导出
- 自动更新机制

因此这些基础能力**不重新实现**。

## 1.2 我们新增的核心能力

新增两个产品层：

### A. Server Credit Analytics

显示：

- Today Derived Credits
- Last 7 Days Derived Credits
- Last 30 Days Derived Credits
- Sol / Terra / Luna Credits 占比
- 每日 Credits 趋势
- 计算置信度 / 校准状态
- Server Analytics 最后同步时间

### B. Compact Monitor

独立的小型 Windows 常驻窗口，只显示：

- 5h 剩余额度
- 5h reset 倒计时
- Weekly 剩余额度
- Weekly reset 倒计时
- Today Credits
- 7D Credits
- 今日 Sol / Luna / Terra 占比
- 实时额度更新时间
- Analytics 更新时间

完整统计仍通过原 Dashboard 查看。

---

# 2. 非目标

V0.1～V0.3 暂不实现：

- 多 OpenAI 账号切换
- ESP32 / 外接小屏
- HTTP / WebSocket 对外 API
- AI 自动给出用量建议
- 根据当前速度预测“还能工作多久”
- DSH/Codex 任务本身的实时状态监控
- 重构整个本地 JSONL scanner
- 用本地 JSONL 重新计算官方额度
- 修改上游原有成本统计的定义
- 自动购买 Credits
- 自动刷新 OAuth token
- 浏览器 Cookie 抓取

这些功能均不得由实现代理“顺手加上”。

---

# 3. 重要术语与数据可信度

项目必须明确区分三类数据。

| 名称 | 来源 | 用途 | 可信度 |
|---|---|---|---|
| **Live Quota** | `/backend-api/wham/usage` | 5h / Weekly / reset | 高、接近实时 |
| **Server-derived Credits** | WHAM daily token + normalized model breakdown 联合推导 | Today / 7D / 30D Credits | 推导值，需要校准 |
| **Local Usage** | `%USERPROFILE%\.codex` / WSL `.codex` | Token、Session、Project、本地 Cost | 本机分析，不等价于服务器计费账本 |

### UI 命名原则

V0.x 中不得把推导 Credits 直接标成：

- `Official Billing Credits`
- `Exact Credits`
- `Actual Billing`

推荐显示：

- `Derived Credits`
- 中文：`推算 Credits`
- 数值前可使用 `≈`

当校准稳定性足够高时，可以显示：

`≈ 4,277 Credits`

而不是：

`4,277.000 Official Credits`

---

# 4. Fork 与 Git 工作流

## 4.1 Fork

首先在 GitHub 将：

`itvincent-git/codex-usage-desktop`

Fork 到自己的账号。

首版建议**不要改仓库名**，便于持续同步 upstream。

例如：

`<YOUR_GITHUB>/codex-usage-desktop`

## 4.2 Clone 与 upstream

```bash
git clone https://github.com/<YOUR_GITHUB>/codex-usage-desktop.git
cd codex-usage-desktop

git remote add upstream https://github.com/itvincent-git/codex-usage-desktop.git
git remote -v

git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
```

如果 `upstream` 已经由 GitHub CLI 自动创建，不重复添加。

## 4.3 分支策略

为了便于长期吸收上游更新，建议：

```text
origin/main
    │
    ├── 始终尽量保持为 upstream/main 的镜像
    │
    └── monitor
          │
          ├── feat/p1-server-credit-data
          ├── feat/p2-server-credit-ui
          └── feat/p3-compact-monitor
```

`monitor` 是我们长期维护的集成分支。

创建：

```bash
git checkout -b monitor main
git push -u origin monitor
```

### 上游更新

```bash
git fetch upstream

git checkout main
git merge --ff-only upstream/main
git push origin main

git checkout monitor
git merge main
```

`monitor` 已经多人/多代理共享后，不建议频繁 rebase + force push。

---

# 5. 开发环境与基线验证

上游要求：

- Node.js >= 24
- pnpm
- Rust
- Tauri v2 所需系统依赖

首次进入项目：

```bash
pnpm install
pnpm test
pnpm typecheck

cd src-tauri
cargo test
cd ..
```

真实 UI 调试必须优先：

```bash
pnpm tauri dev
```

而不是只运行：

```bash
pnpm dev
```

发布构建：

```bash
pnpm tauri build
```

## P0 验收条件

在任何功能修改前，必须保存一份 baseline：

```text
docs/baseline-verification.md
```

至少包含：

- upstream commit SHA
- `pnpm test` 结果
- `pnpm typecheck` 结果
- `cargo test` 结果
- `pnpm tauri dev` 能否启动
- Windows 实际 5h / Weekly 卡片能否读取数据
- 当前应用截图（可选）

**Baseline 未通过时，不进入 P1。**

---

# 6. 现有源码边界

当前重要模块：

```text
src/
├── App.tsx
├── components/
│   ├── codex-limits-card.tsx
│   ├── daily-usage-table.tsx
│   ├── model-usage-card.tsx
│   └── ...
├── hooks/
│   └── use-usage-dashboard.ts
└── lib/
    ├── api.ts
    ├── usage-dashboard.ts
    ├── model-analytics.ts
    └── ...

src-tauri/src/
├── codex_environment.rs
├── codex_limits.rs
├── db.rs
├── lib.rs
├── overview.rs
├── pricing.rs
├── scanner.rs
├── session_replay.rs
├── types.rs
└── ...
```

现有 `codex_limits.rs` 已经实现：

- Codex OAuth/本机登录状态读取
- `/backend-api/wham/usage`
- 5h / Weekly 窗口解析
- reset credits
- fallback 逻辑

### 原则

**不能再写第二套认证体系。**

新的 Server Analytics 必须复用已有 Codex 登录状态。

不使用：

- 浏览器 Cookie
- 手工 Bearer Token 配置
- API Key
- 自己刷新 OAuth token

如果 token 失效：

> 提示用户通过 Codex 正常重新登录，然后刷新应用。

---

# 7. 新增服务器数据源

## 7.1 Live Quota

现有：

```http
GET https://chatgpt.com/backend-api/wham/usage
```

继续由原 `codex_limits.rs` 维护。

刷新建议：

- 默认 30～60 秒
- 手动 Refresh 可立即触发
- reset 倒计时由前端本地每秒更新，无需每秒请求服务器

## 7.2 Daily Workspace Token Counts

新增：

```http
GET /backend-api/wham/usage/daily-workspace-usage-counts
    ?start_date=YYYY-MM-DD
    &end_date=YYYY-MM-DD
    &group_by=day
```

需要的字段：

```text
date
uncached_text_input_tokens
cached_text_input_tokens
text_output_tokens
text_total_tokens
```

注意：

该接口中的 `credits: 0` **不得解释为“未消耗 Credits”**。

这里只使用 Token 数据。

## 7.3 Daily Token Usage Breakdown

新增：

```http
GET /backend-api/wham/usage/daily-token-usage-breakdown
    ?start_date=YYYY-MM-DD
    &end_date=YYYY-MM-DD
    &group_by=day
```

需要：

```text
date
models[].model
models[].speed
models[].credits
units
```

当前已观察到：

```json
"units": "percent"
```

此时 `models[].credits` 实际是**当前查询区间归一化后的 Credit-weighted percentage value**。

绝不能直接显示成 Credits。

---

# 8. Credits 推导算法

## 8.1 当前 Codex 标准模式 Credit Rate

V0.1 使用 OpenAI Codex 当前 token-based rate card：

| Model | Input / 1M | Cached / 1M | Output / 1M |
|---|---:|---:|---:|
| GPT-5.6 Sol | 125 | 12.5 | 750 |
| GPT-5.6 Terra | 50 | 5 | 300 |
| GPT-5.6 Luna | 5 | 0.5 | 30 |

三组费率严格同比：

```text
Luna  = 1 × Base
Terra = 10 × Base
Sol   = 25 × Base
```

其中：

```text
Base = Luna rate vector
     = (5, 0.5, 30)
```

### 重要

费率不得散落硬编码在 UI 中。

创建单独 rate table，并包含：

- model id
- speed
- effective date
- input rate
- cached rate
- output rate
- base multiplier
- source/update timestamp

---

## 8.2 单日 Base Credits

设某日总服务器 Token：

```text
U = uncached input
C = cached input
O = output
```

按 Luna Base Rate：

```text
B = (5U + 0.5C + 30O) / 1,000,000
```

---

## 8.3 WHAM 模型百分比

设：

```text
Psol
Pterra
Pluna
```

为同一天 `daily-token-usage-breakdown` 中的 normalized values。

因为：

```text
Sol   multiplier = 25
Terra multiplier = 10
Luna  multiplier = 1
```

查询窗口的隐藏 Scale K 可由：

```text
K_day =
B /
(
    Psol / 25
  + Pterra / 10
  + Pluna
)
```

求出。

随后：

```text
DerivedCredits_day =
K * (Psol + Pterra + Pluna)
```

模型级：

```text
SolCredits   = K * Psol
TerraCredits = K * Pterra
LunaCredits  = K * Pluna
```

---

# 9. 不允许只使用单日 K

V0.1 必须做多日校准。

## 9.1 校准日期选择

默认请求最近 30 天。

一个日期只有满足全部条件才可参与 K 校准：

1. 不是“今天”
2. Token totals > 0
3. model breakdown > 0
4. `units == "percent"`
5. 所有参与模型均在允许列表
6. 所有 model `speed == "standard"`
7. 只包含当前确认具有比例 rate vector 的模型
8. 分母不为 0

V0.1 的安全允许列表建议只包含：

```text
gpt-5.6-sol
gpt-5.6-terra
gpt-5.6-luna
```

其他模型一旦存在，该日期**不作为 calibration sample**。

这样比为了兼容旧模型而把算法复杂化更安全。

## 9.2 最终 K

获得：

```text
K1, K2, ... Kn
```

使用：

```text
K = median(K1 ... Kn)
```

不要使用 mean 作为第一选择，避免某天同步异常污染整体。

## 9.3 稳定性

计算：

- sample count
- median K
- 每个 Ki 相对 median 的偏差
- median absolute percentage deviation 或等价稳健指标
- max deviation（诊断用）

建议状态：

```text
Excellent : samples >= 3 且稳健偏差 <= 0.5%
Good      : samples >= 3 且稳健偏差 <= 1.0%
Warning   : samples >= 2 且偏差 <= 2.0%
Invalid   : samples < 2 或偏差 > 2.0%
```

阈值首版可按 fixture 调整。

### Invalid 时

不得显示“精确”Credits。

显示：

```text
Credits unavailable
Calibration unstable
```

Live Quota 仍可正常显示。

---

# 10. 查询窗口归一化特性测试

已经验证：

同一天在不同查询窗口会返回不同 percent，例如某日：

```text
7D  -> 100
30D -> 30.xx
```

但窗口内所有日期按同一常数缩放。

因此必须加入一个核心回归测试：

```text
fixture_7d.json
fixture_30d.json
```

要求：

> 相同真实日期在两个不同 normalized windows 中，推导出的 Derived Credits 必须一致（允许极小浮点误差）。

这是 P1 的最高优先级测试。

---

# 11. 当前日与数据延迟

Analytics 不是 Live Quota。

可能出现：

```text
今天 Codex 已经工作很多
但 daily analytics 仍为 0
```

因此：

### Today 状态

若：

```text
daily-workspace-usage-counts 今日 token > 0
```

但：

```text
daily-token-usage-breakdown 今日总 percent == 0
```

则 UI 显示：

```text
Today Credits: Sync pending
```

而不是：

```text
Today Credits: 0
```

### Current Day

当前日不得参与 K 校准。

它可以使用由历史完整日期得到的 K 来推导“目前已同步部分”的 Today Credits，并显示：

```text
≈ 1,820 Credits
Partial / analytics delayed
```

---

# 12. 新 Rust 模块设计

建议新增：

```text
src-tauri/src/
├── server_analytics.rs
├── credit_rates.rs
└── credit_analytics.rs
```

是否新建 `wham_client.rs`，由 P1 实现时根据现有 `codex_limits.rs` 的认证逻辑决定。

### 12.1 `server_analytics.rs`

职责：

- 复用现有 Codex auth
- 请求 daily workspace counts
- 请求 daily token breakdown
- JSON deserialize
- network / auth / schema error
- 不做 Credits 数学

### 12.2 `credit_rates.rs`

职责：

- Model rate table
- effective dates
- 标准 speed 支持判断
- multiplier
- unsupported model detection

### 12.3 `credit_analytics.rs`

职责：

- 对齐两个接口的日期
- 选择 calibration days
- 计算 K_day
- median K
- confidence
- daily/model Credits
- 1D / 7D / 30D aggregates
- pending/partial/invalid 状态

### 12.4 `types.rs`

新增类似：

```rust
ServerCreditAnalyticsResponse {
    fetched_at,
    start_date,
    end_date,
    status,
    calibration,
    today,
    last_7_days,
    last_30_days,
    daily,
    models
}
```

建议结构：

```text
CalibrationStatus
- excellent
- good
- warning
- invalid

DailyCreditUsage
- date
- credits
- is_partial
- models[]

ModelCreditUsage
- model
- credits
- percent

CalibrationSummary
- k
- sample_count
- deviation
- status
```

---

# 13. Tauri Command

V0.1 只增加一个主 command：

```text
fetch_server_credit_analytics
```

建议由 Rust 内部固定请求最近 30 天，然后一次性返回：

- today
- 7d
- 30d
- daily
- model totals
- calibration

前端不需要自己请求 7D 和 30D 两遍。

这样可以：

- 减少请求次数
- 保持同一 normalization window
- 降低前端复杂度
- 保证所有派生数据来自同一 snapshot

---

# 14. 前端 API

在：

```text
src/lib/api.ts
```

新增：

```ts
export type ServerCreditAnalyticsResponse = ...
export async function fetchServerCreditAnalytics(): Promise<...>
```

React 不实现数学公式。

**所有 Credit 推导必须在 Rust 完成。**

原因：

- 数学逻辑只维护一份
- 易做 Rust unit tests
- UI 不能静默修改算法
- 未来 Compact / Dashboard / HTTP provider 可复用

---

# 15. Dashboard UI

在现有 Overview 页增加独立卡片：

```text
SERVER USAGE
────────────────────────────────────

Today              ≈ 4.28K Credits
Last 7 days        ≈ 15.3K Credits
Last 30 days       ≈ xx.xK Credits

Sol                    90.8%
Luna                     6.9%
Terra                    2.3%

Calibration             Excellent
Samples                 5 days
Deviation               0.12%

Analytics updated       5 min ago
```

原来的：

```text
Local Tokens
Estimated API Cost
Projects
Models
Sessions
```

继续保留。

视觉上需要明确：

```text
SERVER
LOCAL
```

不是同一种计量来源。

---

# 16. Compact Monitor

## 16.1 目标

Windows 桌面长期驻留。

建议初始尺寸：

```text
宽：390 px
高：260～290 px
```

示意：

```text
┌──────────────────────────────────────┐
│ Codex Monitor                    ●   │
│                                      │
│  5h       68% 剩余       2h 41m 重置 │
│  █████████████░░░░░░                 │
│                                      │
│  Weekly   43% 剩余       4d 12h 重置 │
│  ████████░░░░░░░░░░░                 │
│                                      │
│  今日             ≈ 4.28K Credits    │
│  最近 7 天        ≈ 15.3K Credits    │
│                                      │
│  Sol 90.8 · Luna 6.9 · Terra 2.3    │
│                                      │
│  Quota 18s · Analytics 5m    ↻   ↗  │
└──────────────────────────────────────┘
```

## 16.2 V0.3 功能

必须：

- always-on-top
- 拖动
- 显示/隐藏
- 系统托盘
- 手动刷新
- 打开完整 Dashboard
- 记住窗口位置
- 记住是否置顶
- dark/light 跟随现有应用策略

可选：

- 透明度

首版不做：

- 自由缩放到任意布局
- 多主题商店
- Widget editor

---

# 17. 刷新策略

建议：

```text
Live Quota:
30～60 秒

Server Analytics:
5 分钟

Reset countdown:
前端每秒本地更新

Manual Refresh:
立即刷新 Live Quota + Analytics
```

失败策略：

```text
Live Quota 获取失败
→ 保留最后成功值
→ 标记 stale

Analytics 获取失败
→ 保留最后成功值（当前进程内）
→ 标记 stale

Auth 失败
→ 提示重新登录 Codex
→ 不尝试自己刷新 OAuth
```

P1 不要求新增持久化 Analytics cache。

如 P3 认为重启后的空白体验明显不好，再单独设计 cache，不提前扩展数据库。

---

# 18. DSH / Codex 双代理协作设计

## 18.1 角色

### DSH / V4 Pro

角色：

**Implementation Owner**

负责：

- 阅读设计文档
- 阅读上游 `AGENTS.md`
- 代码实现
- 单元测试
- fixture
- 本机集成测试
- commit
- PR 描述
- 根据 Review Findings 修复

不得：

- 自己宣布最终通过
- 改需求范围
- 为了方便删除原有功能
- 绕过失败测试
- 未说明地改 Credit 公式

### Codex

角色：

**Independent Reviewer / Supervisor / Gatekeeper**

负责：

- 检查 DSH diff
- 对照本设计文档
- 检查接口解释
- 检查数学公式
- 检查 auth / token 安全
- 检查测试是否真正覆盖
- 运行测试
- 检查 UI regression
- 输出 Review Findings
- 决定 PASS / REQUEST CHANGES
- Release 前最终检查

默认不得直接修 DSH 代码。

目的：

> 保持“实现者”和“审核者”相互独立。

如发现问题：

```text
Codex 提 Finding
        ↓
DSH 修复
        ↓
Codex Re-review
```

只有用户明确要求：

> “Codex 直接修这个问题”

Codex 才创建修复 commit。

---

# 19. 防止代理互相污染判断

Codex Review 时只给：

- 设计文档
- Git diff
- 代码
- 测试
- PR 描述
- 运行结果

不要把 DSH 的长篇 reasoning 直接作为“事实”交给 Codex。

Codex 必须独立验证。

同样：

DSH 收到 Codex Finding 时，只把 Finding 当作待验证问题，不要求它无条件同意。

---

# 20. 开发阶段与 Gate

## P0 — Fork + Baseline

DSH：

- Fork 后环境准备
- baseline tests
- baseline 文档

Codex：

- 确认工作区干净
- 确认 upstream SHA
- 确认 baseline test 没被忽略

Gate：

```text
PASS → P1
```

---

## P1 — Server Credit Data Layer

分支：

```text
feat/p1-server-credit-data
```

DSH 实现：

- server analytics HTTP
- response types
- rate table
- Credit derivation
- calibration
- confidence
- fixtures
- Rust unit tests
- Tauri command
- TS API type

**P1 不做 UI 美化。**

### P1 强制 fixture

至少包括：

```text
fixture_7d_counts.json
fixture_7d_breakdown.json

fixture_30d_counts.json
fixture_30d_breakdown.json
```

数据必须匿名化，不含：

- Bearer Token
- Cookie
- Account ID
- Email
- Session ID

### P1 验收

必须验证：

1. 7D 与 30D 对同一天推导值一致
2. `100 percent` 不被解释为 100 Credits
3. current day 不参与 calibration
4. unknown model 使该 calibration day 被跳过
5. fast speed 被跳过
6. `units != percent` 时不得套 percent 算法
7. K 不稳定时状态为 invalid
8. Token API `credits=0` 不影响计算
9. 无 auth 泄漏到 log
10. 原 Live Quota 测试全部仍通过

Codex P1 审核：

**建议使用 GPT-5.6 Sol + High。**

因为 P1 涉及：

- 未公开服务器接口
- 计量含义
- 数学推导
- OAuth
- Rust 后端
- 异常降级

这是整个项目最值得使用高能力 reviewer 的阶段。

---

## P2 — Dashboard Server Usage

分支：

```text
feat/p2-server-credit-ui
```

DSH：

- Server Usage card
- loading / stale / partial / invalid 状态
- 7/30d trend
- model split
- i18n
- component tests

Codex：

- UI correctness
- 不混淆 server/local
- 不把 derived 写成 official
- loading 状态不覆盖已有 dashboard
- React StrictMode 不导致重复请求
- light/dark
- resize

Gate：

```text
pnpm test
pnpm typecheck
cargo test
pnpm tauri dev
```

---

## P3 — Compact Monitor

分支：

```text
feat/p3-compact-monitor
```

DSH：

- 独立 Tauri window
- tray
- always-on-top
- position persistence
- open dashboard
- live refresh
- countdown
- stale/pending state

Codex：

- Windows Tauri 生命周期
- tray 退出逻辑
- 双窗口状态
- 重复 timer / request
- startup
- DPI
- multiple monitors
- 关闭按钮定义
- background CPU / network usage

---

## P4 — Release Candidate

只在 P1～P3 全部通过后。

必须：

```bash
pnpm test
pnpm typecheck

cd src-tauri
cargo test
cd ..

pnpm tauri build
```

Windows 真机：

- install
- launch
- tray
- compact
- dashboard
- refresh
- close/reopen
- restart Windows app session
- uninstall（至少一次 RC）

Codex 做最终 Release Review。

---

# 21. Codex 模型选择建议

## 推荐配置

### 日常监督 / 普通 PR Review

**GPT-5.6 Terra + High**

这是本项目最合理的默认 reviewer。

适合：

- diff review
- Rust/TS 常规逻辑
- 测试覆盖
- UI regression
- PR 审核
- DSH 修复后的 re-review

原因：

- 审核比实现更需要稳定找问题，但大部分改动并不需要 Sol
- Terra 定位本身就是 capability / cost balance
- 比 Luna 更适合作为“唯一 reviewer”
- 可显著减少持续监督阶段使用 Sol 的必要性

### 必须升级到 Sol 的 Gate

**GPT-5.6 Sol + High**

用于：

- P1 首次 Credit 算法审核
- OAuth / auth 安全相关变化
- Rate Card / normalization 算法变化
- 大规模 upstream merge conflict
- 跨 Rust + React + Tauri 生命周期问题
- Release Candidate 最终审核
- Terra 对问题判断不确定时

### Luna

**不建议作为唯一最终 reviewer。**

适合：

- 汇总测试日志
- 检查格式
- 简单 lint/type error
- 机械性 diff 分类
- 生成 changelog 草稿

但：

> 额度计算、认证、安全、跨模块 regression 不应该只交给 Luna 放行。

## 是否需要 Max？

默认**不需要**。

建议：

```text
Terra + High   → 日常审核
Sol + High     → 核心 Gate
Sol + Max      → 仅在 High 无法解决、复杂异常或重大 release blocker 时
```

不要为了“监督”长期全程使用 Sol Max。

---

# 22. 建议的 Review 节奏

推荐：

```text
DSH 开发一个逻辑单元
        ↓
DSH 本地测试
        ↓
commit
        ↓
Codex Terra High 快速 Review
        ↓
继续开发
        ↓
阶段 PR 完成
        ↓
Codex Sol High Gate Review（P1 / Release）
        ↓
修复
        ↓
Re-review
        ↓
merge
```

这样避免：

- DSH 一口气改几千行再审
- Codex 只在最后看巨大 diff
- Sol 长时间执行低价值监督任务

---

# 23. DSH 主实现提示词

以下内容可直接给 DSH：

```text
你是本项目的主实现代理。

首先阅读：
1. AGENTS.md
2. docs/server-credit-monitor-plan.md
3. 当前阶段涉及的现有源码和测试

你的角色是 Implementation Owner，不是最终审核者。

要求：
- 严格按设计文档当前阶段执行，不提前实现后续阶段。
- 优先最小修改，禁止无关重构。
- 不删除/替换现有功能。
- 任何内部 WHAM API 字段都必须按实际响应处理，不凭名字猜语义。
- daily-token-usage-breakdown 在 units=percent 时必须按设计中的 normalization/calibration 算法处理。
- 不得把 percent 直接展示为 Credits。
- 所有认证复用现有 Codex auth；不得引入浏览器 Cookie、手工 Token 或 API Key。
- 不在 log/test fixture 中写入 access token、cookie、email、account id。
- 每个重要数学分支必须有测试。
- 完成当前阶段后运行项目规定的测试。
- 输出：变更文件、核心决策、测试结果、仍存在的风险。
- 完成当前阶段后停止，等待 Codex Review，不自行继续下一阶段。
```

---

# 24. Codex 审核监督提示词

以下内容可直接给 Codex：

```text
你是本项目的独立 Reviewer / Supervisor / Gatekeeper。

实现由 DSH 完成。你的默认任务不是重写实现，而是独立审核。

首先阅读：
1. AGENTS.md
2. docs/server-credit-monitor-plan.md
3. 当前 PR / commit diff
4. 相关现有源码和测试

审核原则：
- 不相信 PR 描述本身，必须检查实际代码。
- 不采用 DSH 的 reasoning 作为正确性证据。
- 每个 Finding 必须指向具体文件/代码路径/可复现条件。
- 优先检查 correctness、data semantics、auth/security、regression、test gaps。
- 区分 P0/P1/P2/P3 严重度。
- 对内部 WHAM 接口保持保守：字段意义不明确时不能猜。
- 特别验证 units=percent 的处理，不允许 percent 直接变 Credits。
- 验证不同查询窗口归一化后能恢复相同 Derived Credits。
- 验证 current day / stale data / unknown model / non-standard speed 的降级策略。
- 检查是否泄露 Codex auth token、cookie、account id 或用户信息。
- 检查 DSH 是否做了需求外重构。
- 实际运行可运行的测试，而不是只读代码。
- UI 问题应通过真实 `pnpm tauri dev` 路径验证。
- 默认不要直接修改 DSH 分支；先给 Review Findings。
- 最后明确输出：PASS 或 REQUEST CHANGES。

如果是 P1 首次算法审核或 Release Gate，使用更严格的深度审核。
```

---

# 25. Review Finding 格式

Codex 统一使用：

```text
[P1] 标题

位置：
src-tauri/src/xxx.rs:line

问题：
...

为什么是问题：
...

复现/触发条件：
...

建议修复方向：
...

是否阻塞合并：
Yes
```

严重度：

```text
P0  安全/数据严重错误/不可发布
P1  核心功能错误，阻塞当前阶段
P2  应修复但不一定阻塞
P3  优化/可维护性/轻微 UI
```

---

# 26. PR 规则

DSH PR 必须包含：

```text
## Scope
本 PR 实现哪个阶段

## Changed
实际变更

## Not changed
明确没有提前实现什么

## Tests
执行过的命令和结果

## Fixtures
使用的数据，是否匿名化

## Risks
内部接口、同步延迟、模型兼容性等

## Review focus
希望 Codex 特别检查的地方
```

不得用：

```text
Everything works
No issues
Fully correct
```

代替可验证结果。

---

# 27. 安全要求

必须满足：

- 不保存 Authorization Bearer
- 不保存浏览器 cookies
- 不打印 access token
- 不打印完整 auth.json
- 不上传 `.codex` session
- 不上传 fixture 中的账号标识
- 不自动刷新 OAuth
- 不修改 `.codex` 源日志
- Server Analytics 请求只发送正常认证和必要 query
- Debug log 不包含认证 header
- HTTP error 不把完整 header/body 中的敏感字段无过滤写入日志

测试 fixture 只能保留：

```text
date
token counts
model
speed
normalized percent
```

---

# 28. P1 推荐测试案例

至少：

```text
calibrates_same_credits_across_7d_and_30d_windows

does_not_treat_100_percent_as_100_credits

uses_median_calibration

excludes_current_day_from_calibration

skips_unknown_model_calibration_day

skips_fast_speed_calibration_day

rejects_non_percent_breakdown_for_percent_algorithm

marks_calibration_invalid_when_samples_disagree

handles_zero_usage_day

marks_today_pending_when_tokens_exist_but_breakdown_is_zero

does_not_depend_on_counts_credits_field

does_not_expose_auth_in_error
```

---

# 29. 首版完成标准

项目 V0.1 可以认为完成，当：

### Live

- 5h remaining 正确
- Weekly remaining 正确
- reset 正确
- refresh 正确

### Server-derived Credits

- 30D 自动校准
- Today
- 7D
- 30D
- model split
- confidence
- partial / pending
- normalized-window regression test

### UI

- Dashboard Server Usage card
- Compact Monitor
- tray
- always-on-top
- manual refresh
- stale state

### Quality

- Rust tests pass
- TS tests pass
- typecheck pass
- Tauri 真机启动
- Windows build 成功
- 不泄露 auth
- Codex Release Gate PASS

---

# 30. 推荐实施顺序

```text
P0
Fork / baseline
    ↓
P1
Server Credit Data
    ↓
Codex Sol High Gate
    ↓
P2
Dashboard
    ↓
Codex Terra High Review
    ↓
P3
Compact Monitor
    ↓
Codex Terra High Review
    ↓
P4
Release Candidate
    ↓
Codex Sol High Final Gate
    ↓
Release
```

---

# 31. 第一条给 DSH 的实际任务

Fork 和 baseline 完成后，只下发：

```text
实现 P1 — Server Credit Data Layer。

不要实现 Dashboard 卡片，不要实现 Compact Monitor。

先完成：
1. 两个 WHAM daily 接口的数据结构和请求；
2. rate table；
3. calibration / median K；
4. daily/model derived Credits；
5. confidence；
6. fixture 与 Rust tests；
7. Tauri command 和 TS type。

完成所有测试后提交一个独立 commit/PR，然后停止，等待 Codex 审核。
```

这是整个项目最重要的第一阶段。

---

# 32. 参考基线

上游：

- https://github.com/itvincent-git/codex-usage-desktop
- baseline main: `d7132dc79bd8b808c00309c8f9c9eed37b9a09a5`

OpenAI 当前 Codex rate card：

- https://help.openai.com/en/articles/20001106-codex-rate-card

GPT-5.6 model guidance：

- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/guides/latest-model

> WHAM daily analytics 属于未公开/内部接口。本项目必须把它视为可变化的数据源，采用 schema validation、降级和 confidence，而不是假设其永久稳定。
