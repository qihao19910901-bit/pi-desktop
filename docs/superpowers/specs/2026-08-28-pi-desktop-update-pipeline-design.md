# Pi Desktop 更新链路与内置组件升级设计

## 背景

当前安装的 Pi Desktop `1.1.26` 能检测到 GitHub Release `1.1.27`，但更新日志显示自定义下载流程未完成，因此用户没有收到可操作的更新提示。检查发现，`latest.yml` 的安装包 `files[0].url` 是相对文件名，而现有镜像下载逻辑把它当作完整 URL 使用。

同时，Pi Desktop `1.1.27` 的源码包仍内置 `@agegr/pi-web 0.8.9`，低于当前稳定版 `0.8.11`；内置 Pi Agent 为 `0.84.3`。

## 目标

- 让 updater 正确处理 GitHub Releases `latest.yml` 中的相对文件名和完整 URL。
- 发现更新时给出明确的状态反馈；下载完成后保留现有的手动安装方式。
- 将封装项目内置 `@agegr/pi-web` 固定升级到 `0.8.11`。
- 将内置 `@earendil-works/pi-coding-agent` 固定为 `0.84.3`。
- 用自动化测试验证 URL 构造、更新提示与依赖版本，并构建本地安装包/目录进行包内版本验收。

## 非目标

- 不修改独立安装的 Pi CLI。
- 不直接修改已安装的 `Pi Desktop` 目录。
- 不发布 GitHub Release，不自动安装新包。
- 不重构账号、会话、pi-web 服务生命周期或窗口功能。
- 不采用 `0.8.12-beta.1` 预发布版。

## 设计

### 1. Release 下载 URL

`buildDownloadUrls(info)` 接收 `update-available` 的元数据，并从 `info.files[0].url` 获取文件名。若该值已经是 `http(s)` URL，则原样保留；若是相对文件名，则使用 `info.releaseUrl` 或 updater 生成的当前 Release 地址作为基准，构造 GitHub Release 下载 URL。镜像地址在完整 GitHub URL 之上生成，最后保留 GitHub 直连兜底。

如果缺少文件元数据或无法确定 Release 基准地址，函数返回空数组，更新控制器记录错误并停止本轮下载，不伪造下载地址。

### 2. 更新提示

继续关闭 `electron-updater` 的原生自动下载，保留自定义镜像/断点续传下载。收到 `update-available` 后立即记录“发现新版本”；成功下载后弹出“更新包已就绪”，用户手动运行安装包。下载失败时弹出失败提示并保留 GitHub Releases 手动下载链接。

### 3. 依赖版本

修改 `package.json` 的两个直接依赖为：

- `@agegr/pi-web: 0.8.11`
- `@earendil-works/pi-coding-agent: 0.84.3`

同步 `package-lock.json`，使用锁定版本避免构建时重新漂移。`@agegr/pi-web` 的 override 继续确保其内部使用项目指定的 Pi Agent。

### 4. 验证

- Node 内置测试覆盖：完整下载 URL、相对文件名、缺失元数据、下载成功/失败、更新监听注册。
- 运行完整 `npm test`。
- 运行构建目录流程，使用已有 `verify:package` 检查包内 `pi-web` 与 Pi Agent 版本。
- 运行 `npm run build` 生成 Windows 安装包；仅检查产物与包内版本，不安装、不发布。

## 风险与处理

- GitHub/镜像网络不稳定：保留多源下载、超时、断点续传和失败提示。
- `latest.yml` 结构变化：缺少必要字段时安全失败，并由单测固定当前支持的元数据形态。
- Pi Web 与 Pi Agent 版本耦合：使用项目 override 和构建后的包内版本检查，避免只更新声明未更新实际内容。
- 工作区有其他未提交内容：只修改本设计指定的 `pi-desktop` 文件，不清理、不覆盖无关改动。
