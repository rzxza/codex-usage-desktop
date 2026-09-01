# Codex Usage Desktop — E-Inink AutoSync v0.5 P7 Review + P8/P9 Seller Bridge 继续实施规划

**文档版本：** v0.5-review-2  
**日期：** 2026-09-01  
**仓库：** `rzxza/codex-usage-desktop`  
**实施分支：** `feat/eink-autosync-v05`  
**本轮审查基线：** `da01db30a1fb7c9fb36a7ac89d264c022b399608`  
**上一版规划：** `docs/eink-autosync-v05-plan.md`  
**目标设备：** DA14585 4.2" E-Ink，400×300，黑/白/红三色  
**卖家客户端：** “签变时光” Windows 客户端  

---

# 0. 本轮结论

当前分支已经完成了相当一部分软件侧 AutoSync 基础设施：

- `autosync.ts`：纯决策引擎；
- `settings.ts`：设置与 last-success baseline；
- `FileEinkTransport`；
- `use-eink-autosync.ts`；
- E-Ink 设置 UI；
- PNG file sink；
- 相关 Vitest / Rust test；
- DataURL/Blob CSP 修复。

但是 **P0–P7 暂不能判定为通过**。当前实现存在 3 个会直接阻断“无人值守自动化”的 Critical 问题，以及若干需要在接 Seller Bridge 前修正的问题。

因此下一轮不是从头重写，而是：

```text
P7R：修复软件侧 AutoSync 的真实运行语义
        ↓
P8：探测“签变时光”的合法自动化入口
        ↓
若发现 CLI / IPC / 文件入口
        → 直接实现 Seller Transport
        → 真机 E2E
        → v0.5 真正自动化完成

若没有 CLI / IPC
        ↓
P9：Windows UI Automation Bridge
        ↓
真机 E2E
        ↓
v0.5 真正自动化完成

P10：Native BLE（可选 v0.6）
```

**Native BLE 不再是“真正自动化”的前置条件。**

---

# 1. Review Findings

## CRITICAL-1：AutoSync 生命周期挂错位置

当前 `useEinkAutoSync()` 由 `src/components/eink-panel.tsx` 调用。

而 `EinkPanel` 位于 Settings 页面中；`SettingsPage` 又只在主应用 `view === "settings"` 时挂载。

结果：

```text
用户打开 Settings
    → EInkPanel mount
    → useEinkAutoSync 工作

用户离开 Settings / 应用停留 Dashboard
    → EInkPanel unmount
    → AutoSync controller 消失
```

这不满足无人值守要求，更不满足：

```text
Windows 开机 --hidden
主窗口不打开
应用驻留托盘
→ E-Ink 仍应自动同步
```

### 必须修复

AutoSync controller 必须挂在与主应用数据生命周期一致的位置，而不是设置 UI 的生命周期。

推荐方案：

```text
App.tsx
  ├─ useUsageDashboard()
  ├─ useEinkAutoSync(...)      ← 始终只挂载一次
  └─ UI
       └─ SettingsPage
            └─ EinkPanel       ← 只展示/控制 controller，不创建第二个 controller
```

更干净的实现可以使用：

```text
EinkAutoSyncContext / EinkAutoSyncProvider
```

但不要为了抽象而大改项目；最小可维护方案即可。

### 禁止

- 不允许在 `EinkPanel` 和 `App.tsx` 同时各启动一个 hook；
- 不允许两个 timer / 两个 transport 并发推同一张图；
- UI 组件不得拥有 AutoSync 后台任务生命周期。

---

## CRITICAL-2：FileTransport 会把真实写入失败伪装成成功

当前 `FileEinkTransport.uploadImage()`：

```ts
try {
  invoke("eink_write_latest_png")
  return { disposition: "written", ... }
} catch {
  return { disposition: "written", detail: "...latest.png" }
}
```

这违反 AutoSync 最重要的不变量：

> **只有真实 Transport 成功，才允许更新 lastSuccessHash / lastSuccessAt。**

当前行为会导致：

```text
磁盘写失败 / Tauri invoke 失败
    ↓
transport 返回 written
    ↓
AutoSync 标记 success
    ↓
lastSuccessHash 更新
    ↓
后续相同内容被去重
    ↓
实际上 latest.png 根本没有更新
```

### 必须修复

`FileEinkTransport.uploadImage()` 的 native invoke 失败必须：

```text
throw error
```

不得 fallback 为 success。

浏览器/jsdom 测试需要 mock `invoke`，而不是让生产代码吞错误来迎合测试。

增加测试：

```text
invoke reject
→ uploadImage reject
→ lastSuccessHash 不变
→ lastSuccessAt 不变
→ state 进入 retry_wait
```

---

## CRITICAL-3：Pure Engine 有 Retry，但 React Hook 没真正接上

`autosync.ts` 已经实现：

- `getEinkRetryDelayMs()`；
- `handlePushOutcome()`；
- `retry_wait`；
- `pendingHash`；
- `nextPushAt`。

但当前 `use-eink-autosync.ts` 在失败时自行写 state：

```text
status = error
consecutiveFailures += 1
```

没有：

- 调用 `handlePushOutcome()`；
- 写入正确的 `pendingHash`；
- 写 `nextPushAt`；
- 安排 retry timer。

而 decision effect 又不依赖这次失败 state 触发新的调度，因此“1m / 5m / 15m / 30m retry”目前只是 pure unit engine 能力，没有成为运行时行为。

### 必须修复

成功与失败都统一通过 pure engine outcome：

```text
executePush()
  ↓
transport result
  ↓
handlePushOutcome(... success ...)

或

transport throw
  ↓
handlePushOutcome(... failure ...)
  ↓
根据 nextPushAt 安排 retry
```

要求 runtime 和 unit engine 不再维护两套状态语义。

### Retry 要求

```text
fail #1 → 1 min
fail #2 → 5 min
fail #3 → 15 min
fail #4+ → 30 min
```

retry 时永远发送 **最新 snapshot**，不是最初失败的旧图片。

---

# 2. Major / Medium Findings

## MAJOR-1：当前固定优先 `D:\CodexUsage\eink` 不适合作为产品默认路径

当前代码只要检测到 `D:\` 存在，就默认写：

```text
D:\CodexUsage\eink\latest.png
```

这属于机器特定策略，与上一版规划“由 Tauri app-data 决定，不在产品代码硬编码用户磁盘布局”的原则不一致。

### 修复要求

默认必须回到：

```text
Tauri app_data_dir / eink / latest.png
```

如果确实希望本机方便地使用 D 盘，可以后续增加**显式配置的 sink 路径**，但不要以“检测到 D 盘”为条件悄悄改变默认行为。

本轮若实现自定义路径，必须满足：

- 默认仍为 app-data；
- 用户显式选择后才切换；
- targetKey 必须包含 sink destination，避免同一 hash 在不同目标被错误去重。

若不需要自定义路径，本轮就直接去掉 D 盘特判。

---

## MAJOR-2：Windows file replace 仍存在删除旧文件后的空窗

当前逻辑：

```text
write latest.png.tmp
remove latest.png
rename tmp → latest.png
```

这不是严格原子 replace。

对当前单纯 File Sink 尚可运行，但到了 Seller Client watch/file bridge 时，第三方客户端可能恰好在：

```text
old file 已删除
new file 尚未 rename
```

时读取目录。

### 本轮处理

P7R 不要求为此引入大型依赖，但需要至少：

1. 将写入封装为单独 helper；
2. temp 文件必须与最终文件同目录；
3. 错误必须向上传递；
4. 在 P8/P9 如果采用 file-watch 路线，必须升级为稳定 replace 策略后才可判定 Seller Transport PASS。

---

## MAJOR-3：需要证明隐藏/托盘模式运行，而不是只证明 Hook unit test

当前测试覆盖了 hook mount 后 auto push，但没有证明：

```text
不是 Settings 页面
主窗口隐藏
--hidden 启动
→ AutoSync 仍工作
```

P7R 必须增加架构级验证。

---

# 3. P7R — Software AutoSync Repair Gate

P7R 是进入真实 Seller Bridge 前的强制 Gate。

## P7R-1：把 controller 提升到 App 生命周期

建议修改：

```text
src/App.tsx
src/components/settings-page.tsx
src/components/eink-panel.tsx
src/eink/use-eink-autosync.ts
```

可以增加：

```text
src/eink/eink-autosync-context.tsx
```

但不是强制。

### 验收

以下任何 view 下 controller 都只有一个实例：

```text
dashboard
models
projects
daily
monthly
sessions
settings
logs
```

切换 view：

```text
不得 reset last runtime state
不得创建第二套 timer
不得重复 push
```

---

## P7R-2：修复 Transport failure semantics

`FileEinkTransport`：

```text
native write success → disposition: written
native write failure → throw
```

`ManualExportTransport`：

```text
supportsAutoPush = false
auto mode → blocked
手动“导出 PNG”继续走原 export_eink_png
不得把 manual 当 device upload 成功
```

---

## P7R-3：Runtime 统一使用 pure outcome engine

必须删除/避免 hook 内独立定义的失败状态语义。

建议 flow：

```text
evaluateAutoSyncDecision()
  ↓ push
executePush()
  ↓
handlePushOutcome()
  ↓
setState(nextState)
  ↓
若 failure / pending
schedule next due
```

### 不变量

```text
lastSuccessHash
lastSuccessAt
lastSuccessTargetKey
```

只允许 success outcome 修改。

---

## P7R-4：Pending coalescing 真正运行时验证

场景：

```text
12:00 success A
12:05 B
12:08 C
12:11 D
refresh interval = 15 min
```

预期：

```text
12:05 → pending
12:08 → pending 更新为 C
12:11 → pending 更新为 D
12:15 → 只 push D
```

不得 push B/C。

---

## P7R-5：Retry + 最新画面

场景：

```text
12:00 A push 失败
12:00~12:01 数据变为 B
12:01 retry
```

必须发送 B。

再测试连续失败：

```text
1m → 5m → 15m → 30m
```

成功后：

```text
consecutiveFailures = 0
pending cleared
lastError cleared
lastSuccess* 更新
```

---

## P7R-6：Last-Good

API 短暂失败或 snapshot 无有效核心信息时：

```text
不得写空白 latest.png
不得覆盖 last-good
不得更新 lastSuccess
```

`isSnapshotPushable()` 的已有逻辑可以保留并补 runtime test。

---

## P7R-7：跨重启恢复

至少持久化：

```text
lastSuccessHash
lastSuccessAt
lastSuccessTargetKey
settings
```

重启时如果当前像素与 last-success 一致：

```text
不得立即重复写同一张图
```

如果当前像素不同但仍处于 refresh interval：

```text
恢复后应 schedule 到正确 due time
```

如果上次失败：

允许重启后立即重新评估最新画面；不得因为错误的 last-success baseline 永久跳过。

---

# 4. P7R Test Matrix

必须增加/修正至少这些测试：

| ID | 场景 | 预期 |
|---|---|---|
| R1 | File invoke success | success baseline 更新 |
| R2 | File invoke reject | transport reject，baseline 不更新 |
| R3 | autoPush disabled | 不 push |
| R4 | manual transport autoPush | blocked |
| R5 | 同像素同 target | 不 push |
| R6 | 同像素换 target | push |
| R7 | interval 内变更 | pending |
| R8 | pending 多次变化 | due 时只 push 最新 |
| R9 | 第一次失败 | 1m retry |
| R10 | 连续失败 | 1/5/15/30m |
| R11 | retry 前 snapshot 改变 | retry 最新 snapshot |
| R12 | retry 成功 | failure state 清零 |
| R13 | blank snapshot | 不覆盖 last-good |
| R14 | restart same hash | 不重复 push |
| R15 | restart pending content | 正确恢复 interval |
| R16 | view change | controller 不重建 |
| R17 | Settings 未打开 | controller 仍存在 |

测试命令：

```text
pnpm test
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

任何失败不得进入 P8。

---

# 5. P7R Windows Native Smoke Gate

自动化真正依赖 Tauri runtime，jsdom PASS 不够。

至少执行：

```text
pnpm tauri dev
```

验证：

1. 在 Settings 开启 `enabled + autoPush + file`；
2. 回到 Dashboard；
3. 确认 controller 没有停止；
4. 隐藏主窗口到 tray；
5. 等待现有 backend background refresh 或通过受控测试路径产生可见 snapshot 变化；
6. 确认 `latest.png` 仍会更新；
7. 重启应用；
8. 确认相同像素不重复写；
9. 用不可写路径/测试 command 制造写失败，确认 UI/日志显示失败且 baseline 不前移。

如果 Windows WebView hidden 后 timer 被明显节流：

- 记录证据；
- 不继续堆前端 workaround；
- 将 due/retry scheduler 下沉 Rust；
- 不需要下沉 renderer，除非有证据证明必须。

**P7R PASS 后，软件侧 AutoSync 才算完成。**

---

# 6. P8 — “签变时光” Capability Probe

P8 的目标不是写 BLE，而是找到**最短、最可靠、最合法**的自动化入口。

优先级：

```text
1. CLI / 启动参数
2. Local IPC（HTTP / WebSocket / Named Pipe / Local Socket）
3. 文件关联 / watch directory / drop-file 自动导入
4. Windows UI Automation
5. Native BLE（最后）
```

不得倒序。

## P8-0：前提

必须使用用户合法安装/下载的“签变时光”客户端。

允许：

- 查看 exe 路径、版本、签名；
- 查看命令行 help；
- 查看自身进程监听的本地端口；
- 查看本地 named pipe；
- 观察正常上传前后的用户目录文件变化；
- 使用正常 Windows UI Automation；
- 观察正常 BLE GATT/流量用于兼容实现。

禁止：

- 绕过激活；
- 修改客户端授权逻辑；
- 破解账号/设备绑定；
- patch DA14585 firmware；
- 猜测 UUID 后直接写设备。

---

# 7. P8-1：定位客户端与版本

记录：

```text
exe full path
product name
file version
product version
publisher/signature
install directory
user-data directory（如果可确认）
```

输出证据到：

```text
docs/evidence/eink-seller-probe.md
```

不要提交第三方 exe/binary 到仓库。

---

# 8. P8-2：CLI / Shell Integration Probe

检查但不限于：

```text
app.exe --help
app.exe -h
app.exe /?
app.exe --version
```

检查：

- Windows file associations；
- custom URL protocol；
- SendTo / shell open verb；
- 是否可直接以 PNG path 作为启动参数；
- 已运行实例是否接受第二实例的文件参数。

如果发现：

```text
seller.exe <png>
```

或等价能力，立即进入 `SellerCliTransport`，无需继续深挖 BLE。

---

# 9. P8-3：IPC Probe

客户端正常运行并完成一次人工图片上传时，观察：

- localhost listening TCP；
- localhost UDP；
- WebSocket；
- named pipe；
- local socket；
- 临时命令文件；
- AppData/LocalAppData 中出现的 queue / cache / upload job。

注意区分：

```text
真正控制接口
vs
自动更新器/日志/遥测端口
```

只有在通过“一次人工上传前后对照”确认相关性以后，才可实现 transport。

如果确认有稳定本地接口，实现：

```text
SellerIpcTransport
```

要求：

```text
supportsAutoPush = true
connect/discover 若协议支持则实现
uploadImage 必须得到可验证的提交/成功结果
失败必须 throw
```

---

# 10. P8-4：File/Watch Probe

观察人工上传前后：

```text
Temp
AppData
LocalAppData
Documents
安装目录允许写的用户级目录
```

是否出现：

- 固定输入图片路径；
- hot folder；
- queue manifest；
- job JSON；
- 自动导入目录。

如果确实存在**公开/稳定、经正常客户端行为验证**的 file-watch 入口，可实现：

```text
SellerFileBridgeTransport
```

但必须确认：

```text
写入文件
→ 客户端检测
→ 上传设备
→ 可判定提交成功/失败
```

不能仅仅“把文件放到某目录”就标记 device refresh confirmed。

---

# 11. P8 成功分支：CLI / IPC / File Bridge

只要 P8 找到上述任一稳定入口，下一步直接实现 Seller Transport，并做真机 E2E。

此时 v0.5 可以在**不做 Native BLE**的情况下实现真正无人值守：

```text
Windows 启动
Codex Usage Desktop --hidden
后台更新数据
像素变化
interval/pending policy
生成 PNG
Seller Transport
签变时光
DA14585
屏幕刷新
```

---

# 12. P9 — Windows UI Automation Bridge（P8 无接口时）

如果 P8 明确证明无 CLI / IPC / watch 入口，不要继续无限调查，直接进入 UI Automation。

## 12.1 原则

优先使用 Windows UI Automation control tree：

```text
AutomationId
Name
ControlType
InvokePattern
ValuePattern
SelectionPattern
```

禁止以固定屏幕坐标作为首选实现。

固定坐标 mouse click 只允许作为诊断，不可作为 release transport。

## 12.2 SellerUiTransport 流程

```text
1. 检测 seller client process
2. 未运行 → 从用户配置/已发现路径启动
3. 等待主窗口 ready
4. 找到设备连接状态
5. 若客户端支持自动连接，等待目标设备 ready
6. 找到“上传图片/选择图片”控制
7. 通过 UIA 打开文件选择
8. 设置 latest.png
9. 确认上传
10. 等待客户端 UI 显示发送完成/成功状态
11. 返回 submitted / confirmed
```

必须支持：

- 主程序自己隐藏到 tray；
- seller client 最小化/后台；
- 临时找不到控件时报错，而不是乱点；
- 客户端版本变化导致 AutomationId 变化时安全失败；
- 不影响 Codex Usage Desktop 主功能。

## 12.3 Transport Result

如果只能确认 seller client 接受了任务：

```text
disposition = submitted
```

如果能明确确认设备刷新成功：

```text
disposition = confirmed
```

两者 UI 必须区分。

---

# 13. 真正自动化 Definition of Done

只有完成以下 E2E，才可以对用户宣称“真正自动化已实现”：

1. Windows 登录后 Codex Usage Desktop 可 `--hidden` 启动；
2. 不打开 Settings；
3. Codex 数据正常后台更新；
4. 可见 E-Ink 像素发生变化；
5. 到刷新窗口后自动触发；
6. 不需要用户点击预览/导出；
7. 不需要用户手动选择 PNG；
8. 不需要用户手动点击“签变时光”上传；
9. DA14585 真机屏幕完成刷新；
10. 相同图不重复刷新；
11. interval 内多次变化只刷新最终图；
12. 设备/客户端断开时进入 retry；
13. 恢复后自动发送最新图；
14. 失败不能前移 last-success；
15. 重启后继续工作。

通过以上 Gate：

```text
v0.5 = DONE
```

---

# 14. Native BLE v0.6（非 v0.5 前置）

只有在 Seller Bridge 已稳定，或者 seller client 自动化路线被证明完全不可用时，再考虑：

```text
Da14585BleTransport
```

需要先获得真实证据：

- Service UUID；
- Characteristic UUID；
- MTU；
- write-with/without-response；
- packet framing；
- checksum；
- ACK；
- refresh command；
- 图片编码格式。

不得把其他 400×300 E-Ink/NFC/nRF 项目的协议直接套到本设备。

公开网络中即使存在 400×300 墨水屏协议，也只能作为调查参考，不能替代本设备抓到的 GATT/协议证据。

---

# 15. 本轮建议提交边界

建议 DSH 按以下 commit 拆分：

```text
1. fix(eink): move autosync controller to app lifecycle
2. fix(eink): preserve transport failures and wire runtime retry
3. test(eink): cover pending retry and app-lifecycle autosync
4. fix(eink): restore portable file sink semantics
5. docs(eink): record P7R native smoke evidence
```

P7R PASS 后再单独：

```text
6. docs(eink): record seller client capability probe
```

如果找到 CLI / IPC：

```text
7. feat(eink): add seller client transport
8. test(eink): cover seller transport failures
9. docs(eink): record real-device end-to-end validation
```

如果 P8 没找到接口：

```text
7. feat(eink): add Windows UI automation seller transport
8. test(eink): cover UI automation safety failures
9. docs(eink): record real-device end-to-end validation
```

不要把 P7R 修复、P8 调查和巨大 Seller 实现压成一个不可 review 的 commit。

---

# 16. DSH 执行顺序

下一轮 DSH 必须：

```text
A. 从 feat/eink-autosync-v05 @ da01db30 开始
B. 阅读本文件 + 上一版 eink-autosync-v05-plan.md + AGENTS.md
C. 先完成 P7R 全部修复
D. 跑 pnpm test / pnpm typecheck / cargo test
E. 做 Windows Tauri native smoke
F. P7R PASS 后才进入 P8 probe
G. P8 只做事实探测，不猜协议
H. 找到稳定入口则实现最短 Seller Transport
I. 若无稳定入口，提交 capability probe 证据后停止，交给 Codex 决定是否进入 P9 UIA
```

如果当前 DSH 权限不允许访问安装在仓库外的“签变时光”客户端：

```text
不要绕过权限
不要猜
完成 P7R
记录 exact blocker
提交 P7R 结果
```

由下一轮在具备本机客户端访问权限的执行环境继续 P8。

---

# 17. Codex Review Gate

DSH 提交后，Codex 下一轮审查重点：

- controller 是否真的 App-lifetime 单实例；
- FileTransport 是否还存在 silent success；
- runtime retry 是否真实工作，而不只是 pure unit test；
- pending 是否 coalesce latest；
- last-success 是否只由真实 success 更新；
- Settings 不打开时是否仍工作；
- hidden/tray native evidence；
- Seller Probe 是否有事实证据；
- 是否在没有证据时猜 CLI/IPC/BLE；
- 真机 E2E 是否真正取消了人工选择/上传步骤。

只有这些通过后才继续 merge/release。
