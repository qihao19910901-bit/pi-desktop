# Pi Desktop 内嵌终端 — 功能规格

> 日期：2026-08-10
> 状态：待用户复核
> 适用范围：个人自用的 Windows 桌面应用
> 依据：`基恩知识库/05-技术资料/Pi Desktop 差距分析报告.md` P2-3
> 前置：**技术验证（Spike）已完成并通过**（见第 2 节）

## 1. 背景

Pi Desktop 是 Electron 封装，无终端能力（报告问题 #11）。原版 Pi 的核心体验是终端 TUI，桌面版完全丢失。本规格立项内嵌终端，恢复"在窗口里跑 shell"的能力。

## 2. 技术验证结果（2026-08-10 Spike，已完成）

| 验证项 | 结果 |
|---|---|
| node-pty 1.1.0 在 Electron 43.2.0 编译 | ✅ 成功（conpty.node + pty.node） |
| ConPTY 后端（cmd / Git Bash） | ✅ 双 shell 交互正常（spawn/写入/流式输出/ANSI 颜色/cwd/kill） |
| 本机编译前置条件 | ✅ 需要 `PYTHONUTF8=1`（中文系统 GBK 编码坑）+ 关闭 Spectre 缓解（VS BuildTools 缺该组件） |
| xterm.js 前端 | 未实测（纯 JS 渲染 ANSI，风险低） |

**关键技术结论**：
1. node-pty 是原生模块——**必须**在构建时按 Electron ABI 重新编译（electron-rebuild）
2. node-pty 的 binding.gyp 硬编码 `SpectreMitigation: Spectre`，本机/CI 无该 VS 组件 → **需要打补丁**（patch-package 或 postinstall 脚本，进入仓库）
3. 构建脚本需注入 `PYTHONUTF8=1`（CI 的 pwsh 设环境变量即可）

## 3. 功能范围

### P0（最小可用）

1. **终端窗口/面板**：工具菜单 → 终端…，独立 BrowserWindow（复用面板模式）
2. **Shell 类型**：下拉选择 cmd / PowerShell / Git Bash（检测 `settings.json` 的 shellPath，默认 Git Bash）
3. **工作目录**：默认信任目录（trust.json 第一个），可切换（输入框 + 应用）
4. **交互**：键盘输入传递、Ctrl+C 中断、清屏（Ctrl+L）
5. **流式输出 + 颜色**：xterm.js 渲染（ANSI 256 色 + 主题适配深色背景）
6. **多终端标签**：多个 tab，每个独立 PTY，可关闭
7. **进程清理**：标签关闭 / 窗口关闭 / 应用退出时 kill PTY + 进程树（Windows `taskkill /pid X /f /t`）
8. **危险命令提示**：关键词列表（`rm -rf`、`format`、`del /`、`rd /`、`diskpart`、`reg delete` 等）输入时弹确认

### P1（体验完善）

9. 终端会话历史（本次运行内可切换查看）
10. 复制/粘贴快捷键（Ctrl+Shift+C/V）、右键粘贴
11. 字体大小调节（Ctrl+滚轮）
12. 终端标题跟随 cwd

### P2（暂不做）

- 终端分屏（tmux 式）
- SSH 会话管理
- 与 agent 联动（把终端输出喂给 agent）——后续评估

## 4. 技术方案

### 4.1 依赖

```
dependencies: @xterm/xterm（前端终端）、@xterm/addon-fit
dependencies: node-pty（PTY 后端，原生）
devDependencies: @electron/rebuild（构建时按 Electron ABI 重编译）
```

### 4.2 文件

```
electron/terminal-window.js   — 窗口 + PTY 管理（tab ↔ PTY 映射、进程清理）
electron/terminal-preload.js  — sandbox 桥（输入/输出/大小/关闭）
electron/terminal.html        — 终端 UI（xterm.js + 标签栏 + shell 选择 + cwd）
scripts/rebuild-native.js     — postinstall/CI 脚本：node-pty 补丁 + electron-rebuild
patches/node-pty+1.1.0.patch — SpectreMitigation 补丁（patch-package 格式）
```

### 4.3 架构

```
terminal.html (xterm.js)
  │ IPC (terminal:input / terminal:resize / terminal:close-tab)
electron/terminal-window.js
  │ node-pty.spawn(shell, args, {cwd, cols, rows})
  └─ PTY 进程 ←── taskkill /t 清理（标签关/窗关/退出）
```

### 4.4 构建链路（关键）

```powershell
# CI 与本地一致：
$env:PYTHONUTF8 = "1"
npm run rebuild:native        # patch-package 应用补丁 → electron-rebuild -w node-pty
npm run build                 # electron-builder（asarUnpack 已覆盖 node_modules/**）
```

**风险控制**：
- node-pty 编译失败 → 构建失败（硬门），不会发布"半残"版本
- verify-package 增加 terminal 文件必检（沿用面板模式）
- CI 的 windows-latest runner 自带 VS BuildTools ✅

### 4.5 安全

- 终端 = 本机 shell 完全控制权：只监听本机 IPC（无网络端口）
- 危险命令确认：前端关键词匹配 + 确认模态（Electron 不支持 confirm，沿用自定义模态）
- 进程树清理：不残留孤儿进程

## 5. 验收标准

1. 打开终端 → 默认 Git Bash，cwd = 信任目录，提示符正常
2. 输入 `echo hi` → 输出；`ping 127.0.0.1` → 流式输出正常
3. Ctrl+C 中断长命令；Ctrl+L 清屏
4. 颜色：`ls --color` / `git status` 彩色输出正常
5. 切 shell（cmd/PowerShell）→ 新 tab 用所选 shell
6. 危险命令（如 `rm -rf /tmp/x`）→ 弹确认；确认后执行、取消不执行
7. 关标签 → 该 shell 进程树退出（任务管理器验证无残留）
8. 关终端窗口 → 所有 PTY 清理；应用退出 → 无残留
9. 重新构建（含 rebuild:native）→ 全量测试 + verify:package + smoke 通过
10. 全量测试通过（terminal-window 逻辑单测：tab 管理/危险命令匹配/清理调用）

## 6. 工作边界

- 不动 pi-web / pi-coding-agent 源码
- 不做分屏/SSH/agent 联动（P2）
- 终端功能独立成版（不与设置页/面板混发）
- 若 node-pty 在 CI 编译失败且 30 分钟内无法解决 → 本项降级为"仅设计存档"，不阻塞其他 P2
