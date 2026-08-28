# 发现与决策

- [2026-08-28] 目标源码基线为 `F:/软件/我的秘籍/pi-desktop`，当前分支 `main`，版本 `1.1.23`；在隔离分支 `fix/pi-desktop-update-1.1.28` 执行。
- [2026-08-28] 基线 `npm test` 通过 184/184。
- [2026-08-28] 当前已发布远端版本为 `1.1.27`，本次源码版本应提升到 `1.1.28`，不能生成旧版本号。
- [2026-08-28] v1.1.27 发布包声明 `@agegr/pi-web 0.8.9`、Pi Agent `0.84.3`；目标是重新构建并包含 pi-web `0.8.11`。
- [2026-08-28] 当前安装日志显示 1.1.26 已检测到 1.1.27，但自定义下载链路未完成。
- [2026-08-28] 错误记录：一次未带 `cd` 的 `npm install --package-lock-only --ignore-scripts` 在父项目根 `F:/软件/我的秘籍` 执行；未触碰目标 worktree，父根的 `package.json/package-lock.json` 本来就是未跟踪文件，后续不处理、不清理。
- [2026-08-28] 构建首次失败：隔离 worktree 不携带被 `.gitignore` 排除的 `node_modules`，`npm run build:dir` 在 `rebuild:native` 阶段报 `node-pty 未安装，先 npm install`；下一步先在 worktree 安装锁定依赖，再重跑构建。
- [2026-08-28] 错误记录：将 `dist` 作为参数传给 `scripts/verify-release-assets.js`；该脚本只接受 `--version`/`--asset`，未修改文件，已改用正确参数重跑。
- [2026-08-28] 最终重建首次因 Electron 依赖下载 `ETIMEDOUT 20.205.243.166:443` 失败；此前同一源码已构建成功，按项目提示改用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 重试，不归因于代码。
- [2026-08-28] 代码审查首次反馈要求串行化弹窗、限制资产主机并关注 lockfile；已完成前两项并增加测试。尝试手工裁剪 lockfile 时 `npm ci --dry-run` 失败，已恢复完整 npm 10 生成的锁文件；完整锁文件包含 pi-web/Pi Agent 新版本所需的传递依赖闭包，并通过 `npm ci --ignore-scripts --dry-run`。
- [2026-08-28] smoke 首次失败不是服务启动失败：Pi Web 0.8.11 的初始页面不再渲染 `Plugins` 文案，实际稳定导航为 `Models/Skills/Settings`；HTTP 200、服务启动和包内版本均正常。已将 smoke UI 契约更新为 `Settings`，聚焦 helper 26/26 与真实 packaged smoke 均通过。
