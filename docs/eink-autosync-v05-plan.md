# Codex Usage Desktop — E-Ink AutoSync v0.5 实施规划
## 400×300 三色墨水屏自动同步 + “签变时光” Transport Bridge
### DSH 主实现 / Codex 独立审核 Gatekeeper

**文档版本：** v0.5-plan-1  
**日期：** 2026-09-01  
**仓库：** `rzxza/codex-usage-desktop`  
**产品代码基线（本规划提交前）：** `main @ 99458c2b6437dea973affe7c83a9318d00a5b3fb`  
**目标平台：** Windows 10/11 x64  
**目标设备：** DA14585 4.2" E-Ink，400×300，黑/白/红三色  
**卖家客户端：** “签变时光” Windows 客户端  
**技术栈：** 保持 React 19 + Vite + Tauri 2 + Rust，不重写现有 E-Ink renderer  

---

# 0. 文档目的

当前 E-Ink 功能已经完成“数据 → 400×300 三色画面 → 预览/PNG 导出”，但真实使用仍需要人工：

1. 打开 Codex Usage Desktop；
2. 进入设置页；
3. 生成/导出 PNG；
4. 打开“签变时光”；
5. 选择图片；
6. 上传到 DA14585 墨水屏。

v0.5 的目标是把这条链路改成无人值守自动同步：

```text
现有后台数据刷新
    ↓
Codex Limits / Server Credits / Reset Signal
    ↓
E-Ink Snapshot
    ↓
400×300 最终像素
    ↓
Pixel Hash + Last-Good + Refresh Policy
    ↓
AutoSync State Machine
    ↓
Transport
    ├─ FileTransport（软件侧完整验证）
    ├─ SellerClientTransport（v0.5 设备交付目标）
    └─ Native BLE Transport（v0.6，可选，不属于本阶段前置条件）
    ↓
墨水屏
```

本规划的第一原则：**先把 AutoSync 本身做正确，再接真实设备。**

协议未知不得阻塞软件侧 AutoSync；同时也不得通过猜 UUID、猜分包格式等方式“伪实现” BLE。

---

# 1. 当前基线与已知事实

## 1.1 已完成能力

当前仓库已有：

- `src/eink/snapshot.ts`
  - 将 `CodexLimitsResponse`、`ServerCreditAnalyticsResponse`、`CodexResetSignalResponse` 映射为 `EinkSnapshot`。
- `src/eink/renderer.ts`
  - 输出固定 400×300 像素矩阵。
  - 黑/白/红三色量化。
  - 可生成 PNG Blob / DataURL / PNG bytes。
- `src/eink/policy.ts`
  - `enabled` / `autoPush` 判断。
  - 最低 10 分钟刷新限制。
  - 最终 400×300 像素 Hash 去重。
- `src/eink/transport.ts`
  - `MockEinkTransport`。
  - `ManualExportTransport`。
- `src/components/eink-panel.tsx`
  - E-Ink 预览。
  - 原生 Tauri PNG 导出。
- Rust `export_eink_png`
  - 原生 Windows 文件写入路径。
- `src/eink/eink.test.ts`
  - 400×300、三色、Hash、刷新间隔、部分字段变化等测试。

## 1.2 现有后台刷新机制

Rust 后端已经存在：

```text
BACKGROUND_RESCAN_INTERVAL = 5 min
```

并在后台刷新完成后 emit：

```text
background-refresh-completed
```

前端 `useUsageDashboard()` 已监听该事件，并更新：

- Codex limits；
- overview；
- Server Credit Analytics；
- 相关 UI 状态。

因此：

> **E-Ink AutoSync 不得再建立第二套 Codex/Server Credits polling。**

AutoSync 只消费已经进入应用状态的数据。

## 1.3 当前真实设备缺口

`docs/eink-da14585-integration.md` 当前明确记录：

- Direct BLE transport 尚未实现；
- “签变时光” CLI / IPC 尚未确认；
- Service UUID 未知；
- Characteristic UUID 未知；
- MTU 未知；
- write-with-response / without-response 未知；
- 分包格式未知；
- ACK/checksum 未知；
- refresh command 未知。

所以 v0.5 必须先探测“签变时光”的合法自动控制能力，再决定真实设备 Transport。

---

# 2. v0.5 成功定义

## 2.1 软件侧成功定义（必须完成）

即使没有真实墨水屏，也必须做到：

```text
额度/credits/reset 数据变化
    ↓
自动构建 E-Ink Snapshot
    ↓
计算最终像素 Hash
    ↓
遵守刷新间隔
    ↓
相同画面不重复刷新
    ↓
间隔内多次变化只保留最后画面
    ↓
失败可重试
    ↓
异常数据不覆盖 last-good
    ↓
自动写出 app data/eink/latest.png
```

上述链路必须具备自动测试。

## 2.2 v0.5 真实设备成功定义

在合法“签变时光”客户端和真实 DA14585 可用的前提下：

```text
Windows 开机
    ↓
Codex Usage Desktop --hidden
    ↓
后台继续更新 Codex 数据
    ↓
最终 E-Ink 像素发生有效变化
    ↓
达到刷新窗口
    ↓
SellerClientTransport 自动提交最新图
    ↓
墨水屏完成更新
```

用户不需要手工导出 PNG，也不需要每次手工选图。

## 2.3 不属于 v0.5 成功前置条件

以下均不是 v0.5 软件侧的阻塞项：

- 自己实现 DA14585 BLE 协议；
- 修改设备固件；
- 绕过激活；
- 破解卖家客户端；
- 实现跨平台 Linux/macOS 墨水屏传输；
- 多台墨水屏调度；
- 云端远程墨水屏；
- WebSocket/HTTP 对外开放 API。

---

# 3. 强制设计原则

## 3.1 不重复拉取业务数据

AutoSync 不负责：

```text
fetchCodexLimits()
fetchServerCreditAnalytics()
fetchCodexResetSignal()
refreshUsageData()
```

这些继续由现有 Dashboard/后台刷新路径负责。

AutoSync 输入只能是已经存在于应用中的：

```ts
{
  limits,
  analytics,
  resetSignal
}
```

## 3.2 去重必须基于最终像素，而不是业务对象

继续使用：

```ts
hashEinkPixels(renderEinkMatrix(snapshot))
```

不能改成：

```text
JSON.stringify(snapshot)
updatedAt
API payload hash
```

原因：很多元数据变化并不会改变真实屏幕像素。

## 3.3 成功状态只能由 Transport 成功确认后写入

禁止：

```text
PNG 生成成功
→ 就更新 lastSuccessHash
```

必须是：

```text
Transport 完成
→ 更新 lastSuccessHash / lastSuccessAt
```

否则一次设备上传失败会让之后的去重逻辑误判“已经显示了新画面”。

## 3.4 Last-Good 优先

API 临时失败不得把正常屏幕覆盖成一堆 `--`。

如果新 Snapshot 不具备足够有效信息：

```text
block push
keep last-good
```

## 3.5 AutoSync 失败不得影响主应用

任何 E-Ink：

- renderer 异常；
- 文件写入异常；
- 卖家客户端不存在；
- 设备断开；
- UI Automation 失败；
- Transport timeout；

都不得：

- 让 Dashboard 白屏；
- 阻止 Codex usage 刷新；
- 破坏托盘；
- 阻止主应用启动。

## 3.6 禁止坐标硬编码作为正式 UI Automation

如果最终需要 Windows UI Automation：

正式实现必须优先使用：

- AutomationId；
- ControlType；
- accessible Name；
- Window title + child control discovery。

不得将：

```text
mouse click x=812 y=643
```

作为正式产品逻辑。

坐标点击只允许临时探测，不得进入 release transport。

---

# 4. Git 与执行工作流

## 4.1 实施分支

从包含本规划文档的最新 `main` 创建：

```bash
git checkout main
git pull --ff-only
git checkout -b feat/eink-autosync-v05
```

如果分支已存在，不重复创建。

## 4.2 DSH / Codex 分工

### DSH

负责：

- 按阶段实施；
- 运行最小相关测试；
- 提交阶段证据；
- 不跨阶段擅自扩大范围。

### Codex

负责：

- 独立 review；
- 检查状态机和竞态；
- 检查测试是否覆盖实际风险；
- 检查设备 Transport 是否基于证据而不是猜测；
- Release Gate。

### Git 权限冲突规则

仓库 `AGENTS.md` 要求正常完成后提交 Git；但某些 DSH/OpenCode profile 可能明确禁止 `git commit/push`。

如果当前执行 profile 禁止 Git 写操作：

- 不得绕过权限；
- 保留工作树修改；
- 输出 `git diff` / changed files / test evidence；
- 由 Codex Main 或具备权限的上层代理提交。

如果当前执行环境允许 commit，则使用本文第 16 节的 Conventional Commit 切分。

---

# 5. 目标代码结构

软件侧完成后建议形成：

```text
src/eink/
├── types.ts
├── snapshot.ts
├── renderer.ts
├── policy.ts
├── transport.ts
├── settings.ts              # 新增
├── autosync.ts              # 新增：纯状态机/决策逻辑
├── use-eink-autosync.ts     # 新增：React/Tauri orchestration
├── eink.test.ts
├── autosync.test.ts         # 新增
└── settings.test.ts         # 可合并进 autosync.test.ts，避免碎片化

src/components/
└── eink-panel.tsx           # 扩展为设备/自动同步状态面板

src-tauri/src/
├── lib.rs
└── eink/                    # 当 Rust transport command 增长后再拆目录
    ├── mod.rs
    ├── file_transport.rs
    └── seller_transport.rs  # 只有 P9 以后且有证据才创建
```

注意：

- P1-P7 不要求为了“结构漂亮”提前重构 `lib.rs`。
- 当新增 Rust E-Ink command 超过少量函数后再拆 `src-tauri/src/eink/`。
- 不做与本任务无关的目录重构。

---

# 6. Settings 与持久化模型

## 6.1 Settings

扩展 `EinkSettings`：

```ts
export type EinkTransportKind = "manual" | "file" | "seller";

export type EinkSettings = {
  enabled: boolean;
  autoPush: boolean;
  refreshIntervalMinutes: number;
  transportKind: EinkTransportKind;
  deviceId: string | null;
};
```

如果 Seller Client 后续确实需要 executable path，只有在 P8 探测证明需要用户指定时再增加：

```ts
sellerExecutablePath?: string | null;
```

不得提前猜卖家安装路径。

## 6.2 默认值

```ts
{
  enabled: false,
  autoPush: false,
  refreshIntervalMinutes: 15,
  transportKind: "file",
  deviceId: null,
}
```

AutoPush 必须 opt-in。

## 6.3 刷新频率

继续保持硬最低值：

```text
10 minutes
```

UI 推荐提供：

```text
10 / 15 / 30 / 60 min
```

默认 15 分钟。

## 6.4 本地持久化 key

建议集中在 `src/eink/settings.ts`：

```text
eink.settings.v1
eink.sync.v1
```

不要散落多个魔法 key。

`eink.settings.v1`：

```json
{
  "enabled": false,
  "autoPush": false,
  "refreshIntervalMinutes": 15,
  "transportKind": "file",
  "deviceId": null
}
```

`eink.sync.v1` 只持久化跨重启仍有意义的成功基线：

```json
{
  "lastSuccessHash": "...",
  "lastSuccessAt": 0,
  "lastSuccessTargetKey": "file:default"
}
```

不要持久化整个 `EinkSnapshot`。

Pending 不需要持久化：应用重启后，根据当前 Snapshot、last-success hash 和时间窗口重新计算即可。

## 6.5 配置损坏处理

如果 JSON：

- 解析失败；
- 类型不合法；
- interval < 10；

则安全回退默认配置，不能让应用启动失败。

---

# 7. Transport Contract

## 7.1 当前问题

现有 `ManualExportTransport.uploadImage()` 是 no-op。

如果直接接 AutoSync，会出现严重语义错误：

```text
AutoSync 调 uploadImage()
→ Promise resolve
→ 被当作成功
→ 其实设备什么都没收到
```

所以 P1 必须先修正 Transport contract。

## 7.2 新 Contract

建议：

```ts
export type EinkTransportCapabilities = {
  supportsAutoPush: boolean;
  supportsDeviceDiscovery: boolean;
  confirmsDeviceRefresh: boolean;
};

export type EinkPushDisposition =
  | "written"
  | "submitted"
  | "confirmed";

export type EinkPushResult = {
  disposition: EinkPushDisposition;
  detail?: string;
};

export interface EinkTransport {
  readonly kind: "mock" | "manual" | "file" | "seller";
  readonly capabilities: EinkTransportCapabilities;

  discover(): Promise<EinkDevice[]>;
  connect(deviceId: string): Promise<void>;
  uploadImage(deviceId: string, image: Uint8Array): Promise<EinkPushResult>;
  disconnect(deviceId: string): Promise<void>;
}
```

## 7.3 Transport 语义

### Mock

```text
supportsAutoPush = true
confirmsDeviceRefresh = true（仅测试语义）
```

### Manual

```text
supportsAutoPush = false
```

AutoSync 绝不调用它。

如果误调用：

```text
throw UnsupportedAutoPushError
```

不要 silent success。

### File

```text
supportsAutoPush = true
confirmsDeviceRefresh = false
result.disposition = "written"
```

“成功”只表示最新 PNG 已正确写入本机 sink，不表示真实墨水屏已刷新。

### Seller

根据实际探测结果：

```text
CLI/IPC 如果能得到明确完成 ACK
→ confirmed/submitted 根据证据定义

UI Automation 只能确认卖家客户端完成发送操作
→ submitted 或 confirmed，必须依据 UI 能否可靠观察成功状态
```

不得虚构设备 ACK。

---

# 8. AutoSync 状态机

## 8.1 Runtime State

建议定义：

```ts
export type EinkSyncStatus =
  | "disabled"
  | "idle"
  | "pending"
  | "uploading"
  | "success"
  | "retry_wait"
  | "blocked"
  | "error";

export type EinkSyncState = {
  status: EinkSyncStatus;

  lastSuccessAt: number | null;
  lastSuccessHash: string | null;
  lastSuccessTargetKey: string | null;

  lastAttemptAt: number | null;
  lastError: string | null;

  pendingHash: string | null;
  pendingTargetKey: string | null;
  nextPushAt: number | null;

  consecutiveFailures: number;
};
```

UI 可以派生显示，不要求把所有字段暴露给用户。

## 8.2 Target Key

去重不能只看图片 Hash。

如果用户：

```text
FileTransport → SellerTransport
```

即使当前图片完全相同，也必须向新 Transport 推一次。

定义：

```ts
targetKey = `${transport.kind}:${deviceId ?? "default"}`
```

是否去重必须同时满足：

```text
hash == lastSuccessHash
AND
targetKey == lastSuccessTargetKey
```

## 8.3 基本决策流程

伪代码：

```text
onCandidateDataChanged():
    snapshot = buildEinkSnapshot(limits, analytics, resetSignal)

    if !isSnapshotPushable(snapshot):
        state = blocked(insufficient-data)
        return

    pixels = renderEinkMatrix(snapshot)
    hash = hashEinkPixels(pixels)
    targetKey = currentTargetKey(settings)

    if !settings.enabled:
        state = disabled
        return

    if !settings.autoPush:
        state = idle
        return

    if !transport.capabilities.supportsAutoPush:
        state = blocked(transport-not-auto-capable)
        return

    if hash == lastSuccessHash && targetKey == lastSuccessTargetKey:
        clear obsolete pending
        state = idle
        return

    if upload already in flight:
        replace pending with latest candidate
        return

    if normal refresh window not yet reached:
        replace pending with latest candidate
        schedule one due evaluation
        state = pending
        return

    push(candidate)
```

## 8.4 Push 成功

```text
Transport upload succeeds
→ lastSuccessHash = actually uploaded hash
→ lastSuccessTargetKey = target
→ lastSuccessAt = now
→ consecutiveFailures = 0
→ lastError = null
```

然后立即检查：上传期间是否出现了更新的 pending candidate。

如果 pending hash 与刚成功 hash 不同：

```text
保留 pending
按正常 refresh interval 等待
```

不能把新变化丢掉。

## 8.5 Push 失败

失败时：

```text
lastSuccessHash 不变
lastSuccessAt 不变
lastSuccessTargetKey 不变

pending 保留为最新 candidate
consecutiveFailures += 1
lastError = normalized error
state = retry_wait
```

---

# 9. Last-Good / Snapshot Validity

## 9.1 必须增加 `isSnapshotPushable`

最小规则：

以下至少一项有有效值：

```text
quotaRemainingPercent
latestCompleteCredits
sevenDayCredits
```

否则认为当前数据不足，不自动覆盖屏幕。

## 9.2 数值合法性

至少验证：

```text
quotaRemainingPercent: finite && 0..100
credits: null or finite >= 0
coverage: 非负且 complete <= expected
```

不要因为一个辅助字段异常就废弃整个 Snapshot，但核心内容全部缺失时必须 block。

## 9.3 Last-Good 场景

必须测试：

```text
14:00 正常画面成功
14:10 Server API 失败，credits null
14:15 limits 也临时 null
```

结果：

```text
不发送“-- / --”空画面
墨水屏保持 14:00 last-good
```

---

# 10. Pending Coalescing

这是 v0.5 必须实现的关键语义。

假设：

```text
last push = 12:00
refreshInterval = 15 min
```

随后：

```text
12:05 Weekly → 75%
12:08 Weekly → 72%
12:11 Weekly → 68%
```

正确行为：

```text
12:05 pending = 75%
12:08 pending 被替换为 72%
12:11 pending 被替换为 68%
12:15 只发送 68%
```

禁止：

- 排队三次刷新；
- 12:15 发送旧的 75%；
- 因 12:15 没有新的业务数据事件而永久漏发。

## 10.1 Due Timer

允许 AutoSync 自己维护一个 timer，但用途只能是：

```text
pending/retry 已知存在
→ 到 nextPushAt 再执行一次决策
```

它不得自行 fetch Codex 数据。

Timer 到期时使用**当前最新 Snapshot**，不是闭包里缓存的旧 Snapshot。

React 实现应使用 ref/effect event 或等价方式防 stale closure。

## 10.2 Timer 数量

任意时刻最多一个 AutoSync due timer。

新 pending 只更新候选，不创建 N 个 timer。

Unmount 必须 clear。

---

# 11. Retry 策略

## 11.1 Backoff

建议固定：

```text
failure 1 → 1 min
failure 2 → 5 min
failure 3 → 15 min
failure 4+ → 30 min
```

封装为纯函数：

```ts
getEinkRetryDelayMs(consecutiveFailures)
```

方便测试。

## 11.2 Retry 与正常刷新间隔分离

`refreshIntervalMinutes`：

> 控制正常成功后，墨水屏下一次允许内容刷新时间。

`retry delay`：

> 控制失败 Transport 多久重试。

失败以后不应该因为 15 分钟刷新窗口而必须等待 15 分钟才能第一次重试。

## 11.3 Retry 仍然只发最新画面

假设：

```text
12:00 push A 失败
12:01 retry wait
12:03 数据变成 B
```

到 retry 时必须发送：

```text
B
```

而不是 A。

---

# 12. FileTransport — 软件侧完整验证 Sink

P1-P7 必须先完成 FileTransport，真实设备尚不可用也不影响验收。

## 12.1 输出位置

固定写入 Tauri app data：

```text
<app_data_dir>/eink/latest.png
```

Windows 典型形态由 Tauri runtime 决定，不在 TypeScript 里拼 `%APPDATA%` 字符串。

## 12.2 Rust command

新增专用 command，例如：

```text
eink_write_latest_png
```

参数：

```text
bytes
```

Rust：

1. 从 `AppState`/app path resolver 获取 app data；
2. 创建 `eink/`；
3. 写入临时文件；
4. 尽可能原子替换 `latest.png`；
5. 返回最终 path。

不要把 AutoSync 的 `latest.png` 写到 Downloads。

用户主动“导出 PNG”继续使用现有 `export_eink_png` 行为，两个语义不要混合。

## 12.3 原子写入

优先：

```text
latest.png.tmp
→ fsync/close（按现有项目复杂度合理处理）
→ rename/replace latest.png
```

避免未来 Seller Client 恰好读取到半写入文件。

如果 Windows replace 存在占用问题，必须返回失败，不得 silent success。

## 12.4 FileTransport 验收

1. 首次有效 Snapshot 自动生成 `latest.png`；
2. 相同最终像素不重写；
3. 画面变化且达到窗口后文件变化；
4. 间隔内多次变化最终只落最新图；
5. 写入失败不更新 last-success；
6. target 从 manual/file 切换时行为正确。

---

# 13. React Orchestration

## 13.1 新 Hook

新增：

```text
src/eink/use-eink-autosync.ts
```

主调用点：

```ts
useEinkAutoSync({
  limits: codexLimits,
  analytics: serverAnalytics,
  resetSignal: codexResetSignal,
});
```

建议在 `App.tsx` / 与主 Dashboard 生命周期一致的上层调用一次。

不要把完整状态机直接继续堆入 `useUsageDashboard.ts`。

## 13.2 Hidden Window 行为

AutoSync 不得使用：

```text
document.visibilityState === "visible"
```

作为是否推送的条件。

目标就是让应用隐藏到托盘后继续工作。

必须做 Windows 真机验证：

```text
main window hidden
compact window hidden
→ AutoSync 仍能响应后台 refresh
```

如果 WebView 隐藏后 timer/event 在实际 Windows 环境被系统节流到无法满足需求：

- 先记录证据；
- 不做猜测；
- 将 due scheduling 下沉为 Rust event/timer；
- renderer/Hash 仍可保留在当前架构，除非证据证明必须进一步 native 化。

不要一开始就重写整个 renderer 到 Rust。

## 13.3 In-Flight Lock

同一时间只能有一个 push。

必须防：

```text
React effect A
background event B
manual push C
```

同时对同一 Transport 调用。

AutoPush 使用 single-flight；新数据进入 pending。

Manual “立即推送”如果当前已有 upload：

- UI 禁用按钮；或
- 合并成 pending force push；

首版优先禁用按钮，保持简单。

---

# 14. E-Ink Settings / Status UI

扩展现有 `EinkPanel`，不要新做独立页面。

建议结构：

```text
E-Ink 4.2" / 400×300

[ ] 启用 E-Ink
[ ] 自动同步

传输方式
[ File Sink ▼ ]

设备
[ 当前目标 / 自动检测 ]   # transport 支持 discovery 时显示

刷新间隔
[ 15 分钟 ▼ ]

状态
Idle / Pending / Uploading / Retry / Blocked
上次成功：...
下一次：...
最近错误：...
输出路径：...             # FileTransport 时

[立即推送]
[预览]
[导出 PNG]
```

## 14.1 状态文案必须区分

FileTransport：

```text
已写入 latest.png
```

不能写成：

```text
墨水屏已刷新
```

SellerTransport 只有在证据足够时才能显示“发送成功/设备刷新完成”。

## 14.2 Manual 模式

Manual：

- 保留预览；
- 保留人工导出；
- AutoPush checkbox 应 disabled 或显示“当前传输方式不支持自动同步”。

不得让用户以为 Manual transport 可以后台推送。

## 14.3 “立即推送”语义

Manual force push：

- bypass 正常 refresh interval；
- bypass duplicate Hash；
- 不 bypass Snapshot validity；
- 不 bypass Transport capability；
- 不允许并发 upload。

用于首次设备验证、换 Transport 后测试等。

---

# 15. 分阶段实施与 Gate

## P0 — Baseline Freeze

### 工作

从最新 main 创建 `feat/eink-autosync-v05`。

运行：

```bash
pnpm test
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

人工/可自动验证：

- E-Ink preview 正常；
- 导出 PNG 正常；
- 400×300；
- 黑/白/红三色。

### Gate P0

所有已有测试 PASS。

如果基线本身失败：

- 不开始功能实现；
- 报告失败与证据。

---

## P1 — Transport Contract + Settings Store

### 工作

修改：

```text
src/eink/types.ts
src/eink/transport.ts
```

新增：

```text
src/eink/settings.ts
```

完成：

- capabilities；
- PushResult；
- Manual no-op 修正；
- settings defaults/load/save/sanitize；
- sync baseline persistence。

### 测试

至少：

- corrupt settings JSON 回退；
- interval < 10 被 clamp；
- Manual 不支持 AutoPush；
- targetKey 生成稳定；
- transport 改变会形成不同 targetKey。

### Gate P1

无 UI 改动也应完成全部纯模型测试。

---

## P2 — Pure AutoSync Engine

### 工作

新增：

```text
src/eink/autosync.ts
src/eink/autosync.test.ts
```

优先把以下逻辑写成纯函数/可控状态转换：

- Snapshot validity；
- target-aware duplicate；
- next normal push time；
- retry backoff；
- pending replacement；
- success transition；
- failure transition。

### 必测场景

1. disabled 不 push；
2. autoPush false 不 push；
3. transport 不支持 AutoPush → blocked；
4. 第一次有效画面允许 push；
5. 相同 hash + 相同 target 不 push；
6. 相同 hash + 不同 target 必须 push；
7. 非可视元数据变化不 push；
8. quota/credits 可视变化会产生不同 hash；
9. 最小 interval 内变更进入 pending；
10. pending A→B→C 最终只有 C；
11. insufficient-data 保持 last-good；
12. failure 不更新 success baseline；
13. retry delay 正确；
14. retry 使用最新 candidate；
15. in-flight 期间新 candidate 不丢失。

### Gate P2

状态机在完全没有 Tauri/真实设备的单测中能够证明正确。

---

## P3 — FileTransport + Native Atomic Sink

### 工作

Rust 新增专用 command：

```text
eink_write_latest_png
```

TS 新增：

```text
FileEinkTransport
```

### 测试

Rust：

- 创建目录；
- 写文件；
- 替换现有文件；
- 错误传播。

TS：

- invoke 成功 → disposition=written；
- invoke 失败 → reject；
- 不出现 fake success。

### Gate P3

无需真实墨水屏即可得到稳定 `latest.png`。

---

## P4 — React AutoSync Hook

### 工作

新增：

```text
src/eink/use-eink-autosync.ts
```

接入当前 App 数据。

必须：

- 不新增 Codex polling；
- single-flight；
- 一个 due timer；
- stale-closure 防护；
- cleanup；
- hidden window 不主动禁止 AutoSync。

### 测试

使用 fake timers 时遵守仓库 `docs/testing-gotchas.md`。

至少验证：

- interval 到期后 pending 自动执行；
- timer 使用最新 candidate；
- unmount 清 timer；
- 失败后按 backoff retry；
- retry 时用最新 candidate；
- upload in flight 不并发。

### Gate P4

FileTransport 下软件 AutoSync 已经无人值守运行。

---

## P5 — Settings / Status UI

### 工作

扩展：

```text
src/components/eink-panel.tsx
```

实现：

- enabled；
- autoPush；
- transport；
- interval；
- current status；
- last success；
- next attempt；
- last error；
- immediate push；
- preview；
- manual export。

### Gate P5

UI 正确区分 File written 与 device refreshed；Manual 不允许 AutoPush 假成功。

---

## P6 — Integration / Last-Good / Restart

### 工作

验证持久化与重启行为。

场景：

```text
成功 push H1 @ 14:00
退出应用
数据未变
重启
```

同 target 下：

```text
不应无意义重复 push H1
```

如果 target 改变：

```text
必须 push H1 到新 target
```

如果数据在离线期间已经变成 H2：

```text
启动得到有效数据后按 interval/policy 推 H2
```

### Gate P6

重启不会丢失 success baseline，也不会因旧 pending 造成错误刷新。

---

## P7 — Windows Hidden/Autostart Software Gate

### 工作

在真实 Tauri Windows 路径验证：

```bash
pnpm tauri dev
```

重点：

- 主窗口隐藏；
- `--hidden` 模式；
- 托盘驻留；
- 后台 Rust 5 分钟 refresh；
- FileTransport AutoSync；
- pending/retry timer。

### Gate P7

**P0-P7 完成后，软件 AutoSync 被视为独立完成。**

此时即使 Seller Client 尚未分析，也不能再把 renderer/AutoSync 当作未完成。

---

# 16. Seller Client Discovery（P8）

P8 必须建立在用户合法持有/安装的“签变时光”客户端上。

如果执行环境无法访问该 EXE 或外部安装目录：

> 停止 P8，报告所需本地证据，不得绕过 sandbox/agent 权限。

## 16.1 探测优先级

严格按以下顺序：

```text
A. CLI
B. IPC / local API
C. watched-folder / file association / protocol handler
D. Windows UI Automation
E. Native BLE（v0.6，不作为 v0.5 首选）
```

## 16.2 CLI

合法检查：

```text
client.exe --help
client.exe -h
client.exe /?
```

以及快捷方式/文件关联可见参数。

目标：

```text
是否支持 --image / --file / --device / --send / import 等参数
```

有稳定 CLI 即优先采用 CLI Transport。

## 16.3 IPC / Local API

在客户端正常运行和人工上传时观察：

- localhost TCP/UDP；
- WebSocket；
- named pipe；
- local HTTP；
- AppData command queue；
- watched folder。

只做正常本机互操作观察，不修改客户端、不绕过授权。

## 16.4 Evidence 文档

P8 必须更新：

```text
docs/eink-da14585-integration.md
```

至少记录：

```text
client version
install path form（不要写个人敏感路径）
CLI probe result
IPC probe result
file association result
UIA candidate controls
recommended transport
confidence
```

### Gate P8

只有明确得到一种可重复调用路径，才进入 P9。

如果没有 CLI/IPC/file hook，则明确选择 UI Automation；不得猜 BLE。

---

# 17. SellerClientTransport（P9）

## 17.1 优先级

### 方案 1：CLI Transport

最佳。

Rust 调用合法卖家 executable：

```text
Command
→ pass latest.png
→ wait exit/status
→ map to EinkPushResult
```

要求：

- 不拼 shell 字符串；
- 使用结构化 args；
- timeout；
- capture exit code；
- 不记录敏感参数。

### 方案 2：IPC Transport

如果 P8 有稳定本地接口：

- 使用真实协议；
- timeout；
- ACK 定义依据证据；
- 断线时可 retry；
- 不扩大到远程 network API。

### 方案 3：Windows UI Automation

如果无 CLI/IPC：

优先使用 Windows UI Automation：

```text
找到签变时光进程/窗口
→ 找连接状态控件
→ 找图片选择/导入控件
→ 设置 latest.png
→ 找发送控件
→ InvokePattern
→ 等待可观察完成状态
```

禁止正式版本依赖屏幕坐标。

## 17.2 卖家客户端启动

如果未运行：

- 如果配置了合法 executable path，可启动；
- 如果无法确定路径，返回明确错误；
- 不扫描整个磁盘猜安装位置。

如果已运行：

- 复用已有进程；
- 不重复启动多个实例。

## 17.3 设备连接

如果卖家客户端自身负责选择/连接设备：

- v0.5 优先复用卖家客户端已有连接；
- 不硬编码用户 MAC/name；
- 若必须选择设备，使用可配置/发现结果。

## Gate P9

至少完成一次自动 Seller Client submission，并能可靠区分失败。

---

# 18. Seller Transport 失败与恢复（P10）

必须验证：

1. 卖家客户端不存在；
2. 卖家客户端未运行；
3. 客户端运行但设备未连接；
4. 上传过程中客户端无响应；
5. 文件选择失败；
6. 设备发送失败；
7. 客户端恢复；
8. 设备重新连接。

正确行为：

```text
主应用继续工作
pending 保留最新图
按 retry backoff 重试
恢复后发送最新图
```

不得把失败画面标记 success。

---

# 19. 真机 Release Gate（P11）

真实 DA14585 至少完成：

| 场景 | 预期 |
|---|---|
| 正常 foreground | 自动刷新 |
| 主窗口隐藏 | 自动刷新 |
| `--hidden` 启动 | 自动刷新 |
| 相同画面 | 不重复发 |
| 15min 内连续变化 | 只发最后一张 |
| API 短暂异常 | 保持 last-good |
| Seller Client 未启动 | 自动启动或明确 retry/error |
| 设备断开 | 不影响主应用 |
| 设备恢复 | pending 最新图补发 |
| 切换 File → Seller | 同图也会首次推到新 target |
| Manual mode | 不假装 AutoPush 成功 |
| AutoPush OFF | 永不主动操作设备 |
| Immediate Push | 正常绕过去重/间隔但不绕过安全校验 |

并人工检查：

- 方向；
- 黑白红颜色；
- 中文可读性；
- 无裁切；
- 无明显残影异常；
- 实际刷新频率符合设置。

---

# 20. CI / Test Gate

每个阶段结束至少运行：

```bash
pnpm test
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

涉及 Tauri UI/Windows 交互阶段再运行：

```bash
pnpm tauri dev
```

并遵守 `AGENTS.md`：UI 调试从真实 Tauri startup path 开始，不用单独 `pnpm dev` 冒充 native 验证。

## 20.1 AutoSync 单测最低集合

不得只测 happy path。

必须有：

- first push；
- duplicate；
- target change；
- interval pending；
- coalescing；
- insufficient data；
- failure；
- retry；
- failure + newer candidate；
- in-flight race；
- timer cleanup；
- corrupted settings；
- Manual capability block。

---

# 21. 可观测性

日志必须足够 debug，但不能刷屏。

推荐事件：

```text
E-Ink candidate changed: hash=<short>
E-Ink push deferred: nextPushAt=...
E-Ink push started: transport=file target=...
E-Ink push succeeded: disposition=written hash=<short>
E-Ink push failed: transport=seller error=...
E-Ink retry scheduled: attempt=2 delay=5m
E-Ink push blocked: insufficient-data
```

Hash 日志只显示短前缀。

不要记录：

- OAuth token；
- Cookie；
- 私密设备凭据；
- 用户敏感路径完整内容（必要时仅 UI 展示本机 path，不上传日志）。

---

# 22. 并发与竞态约束

必须显式处理：

## 22.1 Upload 中数据变化

```text
push H1 starts
→ H2 arrives
→ H3 arrives
→ H1 succeeds
```

结果：

```text
lastSuccess = H1
pending = H3
```

H2 被合并掉是正确行为。

## 22.2 Upload 中切换 Transport

用户切换 transport 时：

- 不取消已经提交给旧 transport 的 native call，除非 native API 明确支持取消；
- 旧 call 返回后只能更新旧 target 的成功记录；
- 新 target 保留当前最新画面 pending；
- 不能把旧 target success 当作新 target success。

实现时建议 push operation 捕获：

```text
operationHash
operationTargetKey
```

完成回调按 operation 自己的数据更新 baseline。

## 22.3 Settings 关闭

AutoPush 在 pending/retry_wait 时被关闭：

- clear due timer；
- pending runtime 可清；
- 不再主动 push。

重新开启后使用当前最新 Snapshot 重新评估。

---

# 23. 具体文件修改建议

## `src/eink/types.ts`

新增/调整：

- `EinkTransportKind`；
- `EinkTransportCapabilities`；
- `EinkPushResult`；
- `EinkSyncStatus`；
- `EinkSyncState`；
- `EinkSettings`。

避免把 React-specific 类型放这里。

## `src/eink/policy.ts`

保留现有最终像素去重原则。

可新增纯函数：

- `normalizeRefreshIntervalMinutes()`；
- `isSnapshotPushable()`；
- `getNextAllowedPushAt()`；
- `getEinkRetryDelayMs()`。

如果 `shouldRefreshEink()` 已不足以表达 target/retry/pending，可以保留它给基础测试，但不要硬把所有状态机塞进单个 boolean 函数。

## `src/eink/settings.ts`

负责：

- 默认 settings；
- parse/sanitize；
- localStorage read/write；
- sync baseline read/write；
- schema key 常量。

## `src/eink/autosync.ts`

只做可测试状态逻辑，不直接碰 React DOM。

## `src/eink/use-eink-autosync.ts`

负责：

- consume current data；
- renderer bytes；
- current transport；
- timers；
- single-flight；
- state exposed to UI。

## `src/eink/transport.ts`

P1-P7：

- Mock；
- Manual；
- File。

P9 后：

- Seller adapter（如果 TS 层只 invoke Rust command，保持薄 adapter）。

## `src/components/eink-panel.tsx`

只承担交互与状态展示。

不要在组件里实现 retry/pending 业务状态机。

## `src-tauri/src/lib.rs`

P3：

- `eink_write_latest_png`。

P9 后如果命令变多，再拆 `src-tauri/src/eink/`。

---

# 24. 非目标 / 禁止顺手做

本阶段禁止：

```text
× 重写 renderer
× 重画整个 Settings UI
× 重构 useUsageDashboard 全部逻辑
× 建第二套 Server Credits polling
× 修改 DA14585 firmware
× 刷第三方 firmware
× 绕过签变时光激活
× 逆向破解授权
× 猜 BLE UUID
× 猜 packet framing
× 硬编码 MAC/device name
× 正式版硬编码屏幕坐标
× 多设备同步
× 云端推送
× 新增远程 HTTP API
```

发现相关问题可以记录，但不要扩大本轮 diff。

---

# 25. Commit 切分

如果执行环境允许 Git commit，建议：

```text
1. feat(eink): define autosync transport and settings contracts
2. feat(eink): add autosync state machine and scheduling policy
3. feat(eink): add native latest image file transport
4. feat(eink): wire event-driven eink autosync
5. feat(eink): add autosync settings and status controls
6. test(eink): cover autosync races retries and persistence
7. docs(eink): record seller client capability discovery
8. feat(eink): add seller client transport
9. test(eink): validate seller transport failure recovery
10. docs(eink): record v0.5 hardware validation
```

不要为了严格凑 10 个 commit 而人为拆碎；原则是每个 commit 有独立语义、可 review、测试通过。

---

# 26. DSH 阶段输出合同

每完成一个 P 阶段，DSH 必须输出：

```text
Stage: Pn
Status: PASS / BLOCKED

Changed files:
- ...

Key behavior implemented:
- ...

Tests:
- command
- exit code
- summary

Evidence:
- relevant path/log/test

Remaining blockers:
- none / exact blocker

Next stage:
- Pn+1
```

如果 BLOCKED：

- 不跨过 Gate 假装继续；
- 不猜协议；
- 精确说明缺少的证据/权限/真实客户端能力。

---

# 27. 推荐执行边界

## 第一轮：DSH 直接完成

**执行 P0 → P7。**

这部分：

- 不需要真实设备协议；
- 不需要访问卖家客户端内部；
- 可以完整实现并测试 AutoSync 软件链路。

完成后交 Codex review。

## 第二轮：本机 Capability Discovery

执行 P8。

需要：

- 合法“签变时光”安装程序/客户端；
- 本机运行权限；
- 可能需要访问安装目录/进程/本地 IPC。

如果当前 DSH profile 不允许这些权限，交由具备本机权限的执行环境完成，不得规避权限边界。

## 第三轮：真实 Transport

P8 决定 P9 选型：

```text
CLI > IPC > watched file > UI Automation
```

完成 P9-P11。

---

# 28. v0.5 最终验收定义

满足以下全部条件才可标记 v0.5 完成：

### 软件层

- [ ] AutoSync 默认关闭；
- [ ] 使用现有数据刷新，不重复 polling；
- [ ] 最终像素 Hash 去重；
- [ ] target-aware 去重；
- [ ] 最低 10min；
- [ ] pending coalescing；
- [ ] single-flight；
- [ ] retry backoff；
- [ ] retry 使用最新 candidate；
- [ ] Last-Good；
- [ ] success 只在 Transport 成功后记录；
- [ ] settings/success baseline 跨重启；
- [ ] FileTransport 稳定输出 `latest.png`；
- [ ] hidden/autostart 软件链路验证通过；
- [ ] 单元测试覆盖失败与竞态。

### 设备层

- [ ] Seller Client 自动控制路径有证据；
- [ ] 不猜 BLE；
- [ ] 真实设备成功自动提交；
- [ ] 断线不影响主程序；
- [ ] 恢复后补发最新图；
- [ ] 不重复无意义刷新；
- [ ] Windows `--hidden` 下真机验证。

---

# 29. v0.6 后续方向（不在本轮实现）

v0.5 Seller Client Bridge 稳定后，才评估 Native BLE。

需要先获取真实证据：

```text
Service UUID
Characteristic UUID
MTU
write mode
packet framing
checksum
ACK
refresh command
image payload format
```

之后实现：

```text
Da14585BleTransport
```

它应只替换 Transport 层：

```text
AutoSync / settings / hash / pending / retry / last-good
```

全部复用，不重写。

---

# 30. 实施起点

DSH 收到任务后第一步必须：

1. 阅读本文件；
2. 阅读 `AGENTS.md`；
3. 阅读：
   - `src/eink/types.ts`
   - `src/eink/snapshot.ts`
   - `src/eink/renderer.ts`
   - `src/eink/policy.ts`
   - `src/eink/transport.ts`
   - `src/eink/eink.test.ts`
   - `src/components/eink-panel.tsx`
   - `src/hooks/use-usage-dashboard.ts`
   - `src-tauri/src/lib.rs`
   - `docs/eink-da14585-integration.md`
   - `docs/testing-gotchas.md`
4. 确认实际 HEAD 与本文基线差异；
5. 执行 P0；
6. P0 PASS 后按 P1 → P7 顺序实施；
7. 不在第一轮擅自开始 BLE/卖家客户端猜测实现。

**第一轮的明确交付终点：P7 PASS + 可供 Codex review 的软件 AutoSync 完整实现。**
