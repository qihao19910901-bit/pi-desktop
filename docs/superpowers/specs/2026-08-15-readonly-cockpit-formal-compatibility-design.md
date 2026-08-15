# Pi Desktop 正式版只读驾驶舱兼容集成设计

## 目标

在 `pi-desktop` 正式版源码基线中加入只读工作驾驶舱，不改变 Pi 会话、工作流执行、用户配置或 CRM 数据行为。

基线：

- 源码：`F:\软件\我的秘籍\pi-desktop`
- 源码版本：`1.1.23`
- 正式客户端：`1.1.25`
- Electron：`43.2.0`
- `@agegr/pi-web`：`0.8.7`
- `@earendil-works/pi-coding-agent`：`0.84.1`

## 范围

### 包含

- 新增只读快照、工作区解析、HTTP 会话读取和 UI 模块。
- 在正式版 `main.js` 增加 `cockpit:get-snapshot` IPC handler。
- 在正式版 `preload.js` 增加隔离的 `window.piDesktopCockpit.getSnapshot()` 和驾驶舱挂载。
- 保留正式版已有中文提示、Compact 提示、外链拦截、多窗口、设置、终端、插件和更新逻辑。
- 构建独立目录并验证：应用启动、会话 API HTTP 200、Pi 页面、驾驶舱 DOM、0.84.1 依赖版本。

### 不包含

- 不修改 `@agegr/pi-web` 源码。
- 不引入新 npm 依赖。
- 不升级或替换 0.84.1 运行包。
- 不提供执行、批准、继续、提交、部署或数据库操作按钮。
- 不修改用户数据、CRM 数据、API Key 或正式安装目录，直到独立 smoke 全部通过。

## 架构

1. Renderer preload 读取当前 pi-web 页面 URL 中的 session id。
2. Main process 通过本地 `/api/sessions` 获取会话元数据。
3. Main process 只接受匹配当前 session 的 `projectRoot` 或 `cwd`，执行目录存在性、realpath 和 containment 校验。
4. Main process 只读读取允许的 `.rpiv/workflows/runs` 与 `.planning` 文件，生成白名单、长度受限、脱敏快照。
5. Preload 只暴露 `getSnapshot()`，UI 通过 `textContent` 渲染状态条和详情抽屉。
6. 空数据、错误和 fallback 默认收起；宿主 Pi 页面保持优先。

## 安全与兼容性

- 保留 `contextIsolation: true` 和 `nodeIntegration: false`。
- 驾驶舱 preload 需要 `fs/path` 读取 CSS 和本地 UI 模块，因此正式窗口的 preload sandbox 设置改为与已验证源码兼容的配置；不扩大 renderer API。
- 所有外部输入和快照字段继续经过白名单、长度限制、敏感信息过滤和 containment 检查。
- 任何构建或启动失败都停止正式替换并保留当前可用版本。

## 验证

### 代码验证

- 驾驶舱测试全部通过。
- 正式版原有测试不回归。
- 新增/修改 JS 文件通过 `node --check`。
- `git diff --check` 通过。

### 独立 smoke

使用源码自身的 `build:dir` 产物，不使用旧 1.1.0 ZIP：

- 启动进程保持运行。
- `/api/sessions` 返回 HTTP 200。
- 正常 Pi 页面可加载。
- 驾驶舱 anchor/statusbar 存在且默认收起。
- 用户主动点击后可展开详情抽屉。
- 0.84.1 运行包版本保持不变。

### 正式替换

仅在上述 smoke 全部通过后执行：

1. 备份正式安装目录的 `resources/app.asar` 与 `resources/app.asar.unpacked`。
2. 正常退出正式 Pi Desktop。
3. 替换程序资源，不改用户数据目录。
4. 启动正式客户端并复验 HTTP 200、Pi 页面和驾驶舱 DOM。
5. 失败立即停止并从备份恢复。
