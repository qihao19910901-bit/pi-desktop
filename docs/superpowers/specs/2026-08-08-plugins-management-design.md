# Pi Desktop 插件管理面板 — 功能规格

> 日期：2026-08-08
> 状态：待用户复核
> 适用范围：个人自用的 Windows 桌面应用
> 依据：`基恩知识库/05-技术资料/Pi Desktop 差距分析报告.md` P1-4

## 1. 背景与现状调研（2026-08-08 实测）

### 1.1 pi-web 0.8.7 后端 API（已完整实现，能力充足）

`GET /api/plugins?cwd=<path>` 返回：

```jsonc
{
  "packages": [{
    "source": "npm:@scope/pkg@1.2.3 | git:... | 本地路径",
    "scope": "project | global",
    "disabled": false,              // 显式禁用标记
    "installedPath": "...",         // null = 未安装
    "packageName": "pkg",
    "version": "1.2.3",
    "configuredVersion": "1.2.3",
    "counts": { "extensions": 0, "skills": 0, "prompts": 0, "themes": 0 },
    "resources": [{ "kind": "extension|skill|prompt|theme", "name": "...", "path": "...", "relativePath": "..." }],
    "status": "disabled | loaded | installed | missing"   // 4 态
  }],
  "totals": { "extensions": 0, "skills": 0, "prompts": 0, "themes": 0 },
  "diagnostics": [{ "type": "warning|error", "source": "...", "message": "..." }],
  "projectResourcesLoaded": true    // 项目是否受信任
}
```

`POST /api/plugins` body `{ cwd, action, source?, scope? }`，action 支持：

| action | 行为 | 前置条件 |
|---|---|---|
| `install` | `installAndPersist(source, {local})` | source 必填；project scope 需项目受信任 |
| `remove` | `removeAndPersist(source, {local})` | source 必填；同上 |
| `update` | `update(source)` | — |
| `disable` / `enable` | 切换 disabled 标记并持久化 | source 必填；同上 |

安全门控（API 自带）：
- Host 校验（`EN`）→ 403 "Untrusted API request"
- Content-Type JSON → 415
- cwd 必须在允许目录内 → 403 "Access denied"
- **project scope 修改必须项目已信任** → 403 "Project resources must be trusted before modifying project plugins"

### 1.2 pi-web 前端现状（缺口确认）

- **没有任何前端文件调用 `/api/plugins`**（asar 全量检索确认，0 处调用）。
- 侧边栏"插件"入口存在（条件渲染），点击后无实际管理界面。
- 桌面端 v1.1.6 验收记录的"Plugins 入口可打开、状态显示未配置"与此一致。

**结论：后端能力完整，缺的是管理 UI。**

## 2. 方案选择

| 方案 | 说明 | 评估 |
|---|---|---|
| A. fork pi-web 加 UI | 上游包，CI 自动更新会覆盖改动 | ❌ 不可持续 |
| B. **桌面壳插件管理面板**（本方案） | Electron 主进程 IPC + 独立 BrowserWindow，调用现有 /api/plugins | ✅ 自有代码，可持续 |
| C. preload 注入增强 | DOM hack，脆弱 | ❌ |

**选定 B**：与现有架构一致（main.js 已管理多窗口/托盘，piweb-service 已封装 HTTP 调用）。

## 3. 功能范围

### P0（最小可用）

1. **插件列表**：表格/卡片展示每个插件
   - 来源（source）、作用域（项目/全局）、状态徽章（已加载/已禁用/已安装/缺失/加载失败）
   - 资源计数（扩展/技能/提示词/主题）
   - 诊断信息（diagnostics 的 warning/error，如"配置了但未安装"）
   - 项目信任状态提示（projectResourcesLoaded=false 时横幅提示）
2. **操作入口**：
   - 安装（输入 source：npm:xxx / git:xxx / 本地路径，选择作用域）
   - 移除（确认对话框）
   - 启用/禁用（切换）
   - 更新（update）
3. **安全提示**：
   - 项目作用域操作时，若项目未受信任 → 显示引导（去项目信任页）
   - 安装来源说明：npm 包名 / git 仓库 / 本地目录，及各自风险提示

### P1（体验完善）

4. 插件详情抽屉：展开显示 resources 列表（扩展/技能/提示词/主题各自路径）
5. 刷新按钮 + 自动刷新（安装/移除后）
6. 空状态引导（无插件时显示示例命令 `npx pi install npm:xxx`）
7. 错误 toast（API 错误信息直接展示）

### P2（暂不做）

- 插件市场浏览/搜索
- 版本兼容检查（上游 API 暂不提供）
- 与 Extensions/Packages/Prompt Templates 面板统一（后续单独立项）

## 4. 技术方案

### 4.1 新增文件

```
electron/plugins-window.js   — 插件管理窗口（BrowserWindow + 本地 HTML 页面）
electron/plugins.html        — 管理面板页面（纯 HTML+JS，无框架，风格与现有窗口一致）
electron/plugins.css         — 样式
electron/plugins.js          — 页面逻辑（调 IPC）
```

### 4.2 主进程

- 菜单/托盘新增"插件管理…"入口（或在现有菜单加）
- `plugins-window.js`：
  - 创建 BrowserWindow（约 720×560，父窗口居中）
  - `ipcMain.handle('plugins:list', (e, cwd) => fetchPiWeb('/api/plugins?cwd=...'))`
  - `ipcMain.handle('plugins:action', (e, { cwd, action, source, scope }) => fetchPiWeb('/api/plugins', POST))`
  - 复用 `piweb-service` 的 HTTP 封装（或新增轻量 fetch 封装）
  - cwd 默认取当前会话工作目录（`window-state.json` / 主窗口状态），可下拉选择

### 4.3 安全

- 面板页面 `contextIsolation: true, nodeIntegration: false, sandbox: true`
- 所有操作经主进程 IPC 转发，页面不直接接触 pi-web HTTP
- 项目未受信任时禁用 project scope 的写操作（前端 + 后端双重门控）
- 卸载/移除前二次确认

### 4.4 中文化

- 面板文案全部中文（直接写中文，不走 preload 字典——面板是本地页面）
- 写完后调 humanizer-zh 去 AI 味

## 5. 验收标准

1. 打开插件管理窗口 → 列表加载当前 cwd 的插件（含状态/计数/诊断）
2. 空环境 → 显示空状态引导，无报错
3. 安装 `npm:xxx`（或本地路径）→ 列表刷新出现新插件，状态"已加载"
4. 禁用/启用 → 状态徽章变化，刷新后保持
5. 移除 → 二次确认 → 列表移除
6. 项目未信任时 → project scope 操作被禁用且有引导提示
7. API 错误（无效 source 等）→ 错误信息展示，不白屏
8. 窗口关闭后无残留进程（复用现有生命周期清理）
9. 全量测试通过（新增主进程 handler 单元测试）

## 6. 工作边界

- 不动 pi-web 源码（上游），只加桌面壳层
- 不并入其他功能（Extensions/Packages 面板后续单独立项）
- 不发布，等下次 CI 上游更新时带出

## 7. 实现状态（2026-08-08）

**已实现（P0 全部，main 92b195e/6258e36/7e5f25c）**：

| 组件 | 说明 |
|---|---|
| `electron/plugins-window.js` | 窗口 + IPC；handler 逻辑抽成纯函数（可测） |
| `electron/piweb-fetch.js` | 回环 HTTP 封装（拒非回环、超时、透传 pi-web 错误信息） |
| `electron/plugins-preload.js` | sandbox 兼容 contextBridge 桥 |
| `electron/plugins.html` | 全中文面板：4 态状态徽章/资源计数/诊断/信任横幅/安装表单/cwd 切换/二次确认 |
| main.js | 工具菜单入口 + 退出清理 |

**实现中修正的设计偏差**：

1. `/api/default-cwd` 是 POST 且每次创建日期目录（`~/pi-cwd-YYYYMMDD`）——不是项目 cwd。改为读 `~/.pi/agent/trust.json` 第一个信任目录；面板支持手动切换 cwd。
2. 实测 cwd 权限：仅信任目录可通过（`C:/Windows`、不存在目录、homedir 均 403 "Access denied"）。
3. 实测发现**本机已有 5 个已配置插件**（settings.json packages：pi-pi、pi-web-access、pi-hermes-memory、@vigolium/piolium、pi-tian-repo-model），此前"未配置"只是 UI 未展示。

**验证**：136 测试全过（+12：HTTP 封装 5、handler 逻辑 6、trust 解析 1）；真实 API 探测 200；页面脚本语法检查通过。

**待真实验收**：发布后手动打开 工具 → 插件管理…，验证列表/安装/移除/启停在真实窗口的交互。
