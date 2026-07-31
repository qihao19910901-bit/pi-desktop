# Pi Desktop 稳定封装与上游同步设计

日期：2026-07-31

状态：待用户复核

适用范围：个人自用的 Windows 桌面应用

## 1. 背景

Pi Desktop 不是 Pi 的分叉，也不替代 pi-web。它把 Pi Agent 和 pi-web 放进一个可安装、可启动、可更新的 Windows 桌面应用。

现场旧版可以运行，但封装和发布链存在实际问题：

- EXE、app.asar、package.json 和运行依赖显示不同版本。
- 应用依赖固定路径 `I:\NODE\node.exe`，不是真正独立运行。
- pi-web 监听 `0.0.0.0:30141`，同一局域网的其他设备可能访问。
- 依赖在 app.asar 和 resources 中有重复打包信号。
- 自动更新流水线先提交版本再构建，构建失败仍会污染主分支。
- 最近的 Release 没有可用安装资产，客户端更新链没有闭环。

本设计修复桌面封装层，不重写 Pi，不 fork pi-web。

## 2. 目标

第一阶段交付以下结果：

1. 双击应用即可运行，不依赖系统安装的 Node.js。
2. 使用原版 Pi Agent 和原版 pi-web 的稳定发行包。
3. 保留 `~/.pi` 中的会话、模型、认证、Plugins 和 Skills。
4. 同时跟踪 Pi 与 pi-web 的稳定版本。
5. 候选组合通过构建和兼容测试后，才发布新的桌面版本。
6. 客户端通过 electron-updater 获取 GitHub Release。
7. 更新失败时继续使用上一个可用版本。
8. 旧安装版保留为回退，直到新版完成真实使用验收。

## 3. 不做什么

第一阶段不包含：

- 重写 Pi Agent。
- fork 或重写 pi-web。
- 把 Pi TUI 原样改成 Web 控件。
- 内嵌终端。
- 商业发布页面、多用户更新渠道或付费代码签名。
- 自动追踪 GitHub main 的每次提交或预发布版本。
- 修改或迁移现有 `~/.pi` 数据格式。

## 4. 产品边界

桌面版继承 pi-web 已通过 SDK 暴露的能力，包括 Agent、Extensions、Packages、Skills、Prompt Templates、会话、分支、模型和文件浏览。

纯 TUI 能力仍属于终端模式，例如终端布局、终端快捷键和只对 TUI 有意义的渲染组件。以后确有需要时，可把内嵌终端作为独立项目设计，不与本次稳定封装混在一起。

架构图见：

- `diagrams/pi-desktop-upstream-sync.mmd`
- `diagrams/pi-desktop-upstream-sync.svg`
- `diagrams/pi-desktop-upstream-sync.png`
- `diagrams/pi-desktop-upstream-sync.excalidraw`

## 5. 运行架构

### 5.1 组件

桌面应用由三层组成：

1. Electron 主进程负责窗口、托盘、单实例、pi-web 子进程和自动更新。
2. pi-web 提供 Web UI，通过 Pi SDK 创建和驱动 AgentSession。
3. Pi Agent 提供模型、工具、扩展、包、Skills 和会话能力。

### 5.2 Node 运行时

Electron 固定到一个明确的 43.x patch 版本。该版本内置 Node 24，满足 pi-web 和 Pi 当前要求的 Node >=22.19。

开发版和打包版都通过 `process.execPath` 配合 `ELECTRON_RUN_AS_NODE=1` 启动 pi-web。代码中不再出现本机 Node 绝对路径，也不继续维护 `worker_threads` 或 undici polyfill。

Electron 不随 Pi/pi-web 的每日检测自动升级。Electron 和 electron-builder 由人工发起独立升级，避免一次更新同时改变三套运行时。

### 5.3 本地服务

pi-web 固定监听 `127.0.0.1:30141`，不监听所有网卡。

启动前检查端口。如果端口被其他进程占用，应用显示明确错误并停止启动，不结束不属于自己的进程。单实例锁防止 Pi Desktop 自己重复占用端口。

健康检查必须同时满足：

- HTTP 返回 2xx。
- 页面包含预期的 Pi Web 内容信号。
- pi-web 子进程仍然存活。

应用退出时先请求子进程正常结束，超时后只清理自己创建的进程树。

### 5.4 用户数据

Pi Desktop 继续使用 Pi 默认的 `~/.pi` 目录。新版不复制、不重命名、不删除该目录。

Electron 自己的窗口状态和更新缓存仍放在 Electron userData。封装升级不得覆盖 Pi 会话、模型配置、认证文件、Plugins 或 Skills。

## 6. 打包设计

app.asar 只包含 Electron 外壳代码和必要资源。pi-web 及其生产依赖只保留一份，放在 resources 下。

打包清单必须包含所有运行入口，例如 main、tray、updater 和最小 preload。产物测试会解包 app.asar 并核对必需文件，防止再次出现“源码存在、安装包缺文件”。

preload 不再遍历 DOM 翻译文案。pi-web 已有原生 `zh-CN`，桌面版只保留确有需要的安全 IPC，例如受控的外链打开。

版本只从根 package.json 产生。应用“关于”页面、EXE 元数据、Release tag、latest.yml 和运行日志必须显示同一个桌面版本。Pi 与 pi-web 版本从实际打包包读取并展示，不写死字符串。

## 7. 上游同步规则

### 7.1 跟踪对象

流水线同时跟踪：

- `@earendil-works/pi-coding-agent` 的 npm `latest`，来源对应 `earendil-works/pi` 稳定 tag。
- `@agegr/pi-web` 的 npm `latest`，来源对应 `agegr/pi-web` 稳定 tag。

只处理正式稳定版本。预发布版本和 GitHub main 提交不触发桌面发布。

### 7.2 可复现依赖

package.json 中的 Pi 和 pi-web 使用精确版本，不使用 `^` 或 `~`。package-lock.json 是构建事实源，CI 使用 `npm ci`。

检测到任一上游变化后，流水线在临时工作树中生成候选 package.json 和 lockfile。候选文件在质量门通过前不提交到 main。

Pi 可以独立于 pi-web 升级，但必须经过同一组兼容测试。如果新版 Pi 与当前 pi-web 不兼容，本次候选失败并停止发布，等待 pi-web 更新或人工处理。

### 7.3 桌面版本号

每次通过质量门的上游组合只生成一个新的 Pi Desktop patch 版本。相同的 Pi/pi-web 组合重复运行时不得再次涨版本。

Release 说明列出三项真实版本：Pi Desktop、pi-web、Pi Agent。

## 8. 发布流程

流水线按以下顺序运行：

1. 读取当前锁定版本和 npm 稳定版。
2. 没有变化时正常结束，不构建、不提交。
3. 生成候选依赖和候选桌面版本。
4. 执行 `npm ci`、单元测试和依赖一致性检查。
5. 构建 Windows 安装包。
6. 检查 app.asar、resources 和版本元数据。
7. 启动打包后的应用，执行 HTTP 与 UI smoke test。
8. 质量门通过后，创建版本提交和同版本 tag，并原子推送到 main。
9. 生成 draft GitHub Release，上传 EXE、latest.yml 和 blockmap。
10. 确认 draft 中三项资产存在且版本一致。
11. 发布 Release，使客户端可见。

质量门完成前的任何失败都不能修改 main，也不能创建 tag。任何步骤失败都不能发布可见 Release。空 Release 被视为失败。失败任务保留日志和构建诊断，但不修改用户现有安装。

Git push 成功后，如果 draft 资产上传或发布动作失败，main 可能已经包含通过质量门的版本提交，但客户端仍看不到该版本。下一次运行必须识别这个版本并修复同一个 draft，不得生成新的 patch 版本。

## 9. 客户端自动更新

安装版通过 electron-updater 检查 `qihao19910901-bit/pi-desktop` 的正式 GitHub Releases。

更新行为：

- 启动后延迟检查，避免争抢启动资源。
- 只接受比当前版本新的稳定 Release。
- 下载完成后提示用户“立即重启”或“稍后”。
- 用户选择稍后时，退出应用后安装。
- 下载或校验失败只记录错误并继续运行当前版本。

第一阶段不支持降级按钮。回退通过保留旧安装目录和上一版 GitHub Release 完成。

## 10. 错误处理

主进程必须处理以下情况：

- pi-web 入口缺失：立即显示错误，不等待 60 秒后才失败。
- 端口被占用：显示占用信息，不杀未知进程。
- 子进程启动失败：保留 stderr，页面显示可执行的错误摘要。
- 子进程意外退出：空闲状态下最多自动重启一次；连续失败后停止重试。
- 健康检查超时：显示失败并提供“重试启动”，不只刷新错误页。
- 更新检查失败：不影响 Agent 主流程。
- Release 资产不完整：客户端忽略该版本，CI 阻止发布。

错误页面不得把未转义的错误文本直接拼入 HTML。

## 11. 安全约束

- pi-web 默认只监听 loopback。
- BrowserWindow 保持 `contextIsolation: true` 和 `nodeIntegration: false`。
- preload 只暴露白名单 IPC，不向页面暴露 Node、fs 或 shell。
- 外链只允许 `http:` 和 `https:`，调用失败要记录。
- 项目级 Pi Extensions 继续使用 pi-web/Pi 的 trust gate。
- 自动更新只接受配置仓库的正式 Release，不允许任意更新 URL。
- 日志不输出 API Key、Token、认证文件内容或完整环境变量。

该应用仅供本人使用，所以第一阶段不购买 Windows 代码签名证书。安装时可能出现 SmartScreen 提示，这是已接受的限制。

## 12. 测试与质量门

测试优先使用 Node 标准库和 `node:test`，不为简单逻辑新增测试框架。

### 12.1 单元测试

- 端口和 URL 配置。
- 版本组合和桌面版本递增规则。
- 健康检查的状态码、内容信号和超时。
- 子进程退出、单次重启和停止条件。
- HTML 错误文本转义。
- Release 资产完整性判断。

### 12.2 产物测试

- app.asar 必需文件齐全。
- resources 中只有一份生产依赖。
- 安装包不包含开发缓存、测试和重复 Electron 运行时。
- EXE、app.asar、latest.yml 和 Release tag 版本一致。
- 打包的 Pi/pi-web 版本与 lockfile 一致。

### 12.3 启动 smoke test

- 应用进程启动，pi-web 在 60 秒内就绪。
- pi-web 仅监听 `127.0.0.1:30141`。
- 就绪后的本机 HTTP 请求返回 2xx、关键内容正确，单次响应不超过 2 秒。
- UI 能看到 Models、Skills、Plugins、会话列表和 Compact。
- 退出应用后 pi-web 子进程消失。
- `~/.pi` 的现有会话和 Plugins 仍可读取。

UI smoke 使用 Electron 的 CDP 和 Node 内置能力，不额外下载一套浏览器。

### 12.4 更新 smoke test

- draft Release 的 EXE、latest.yml、blockmap 均存在。
- latest.yml 指向当前 EXE，版本和哈希一致。
- 旧版客户端能发现新版本并完成下载。
- 选择“稍后”不打断当前会话。
- 重启安装后版本更新，`~/.pi` 数据不变。

## 13. 上线与回退

新版先安装到独立目录，不覆盖当前 `F:\软件\我的秘籍\PI\Pi Desktop`。新旧版本都使用 30141，验收时必须轮流启动，不能同时运行。

验收顺序：

1. 退出旧版，确认旧 pi-web 子进程已经结束。
2. 用同一份 `~/.pi` 启动新版，读取现有会话和插件。
3. 完成一次真实 Agent 对话。
4. 验证托盘、退出、重启和自动更新。
5. 连续使用稳定后，把桌面快捷方式切到新版。

旧目录和旧快捷方式目标在切换前记录。新版出现阻断问题时，把快捷方式切回旧 EXE，不删除用户数据。

旧版是否删除由用户另行确认，不纳入自动清理。

## 14. 影响面与风险

预计影响模块：

- Electron 主进程和子进程管理。
- preload 与外链 IPC。
- electron-builder 打包清单。
- package.json 和 package-lock.json。
- GitHub Actions 更新发布流程。
- 自动更新模块。
- 新增的单元、产物和 smoke test。

风险等级：高。原因是改动覆盖启动、打包和更新主链，失败会让应用无法启动或无法更新。用户数据格式不改，数据风险低。

实施必须拆成小提交，每个提交不超过 8 个文件和 300 行人工修改。依赖锁、生成产物和整文件删除按项目规则单独计算。

## 15. 验收标准

设计完成后的实现必须满足：

- 新机器不安装 Node.js 也能启动 Pi Desktop。
- 实际 Pi 和 pi-web 版本在应用内可查，且与 Release 一致。
- 现有 `~/.pi` 会话、模型、Plugins 和 Skills 可直接使用。
- 服务不监听局域网地址。
- 安装包没有重复依赖，必需入口不缺失。
- 上游稳定版变化会触发候选构建。
- 兼容测试失败不会修改 main，也不会发布空 Release。
- 质量门通过后，旧版客户端可自动更新到新版本。
- 新版失败时可以切回当前旧应用。
