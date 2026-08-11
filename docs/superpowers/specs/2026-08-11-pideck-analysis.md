# PiDeck 深度分析 — 可借鉴清单

> 日期：2026-08-11
> 对象：https://github.com/ayuayue/PiDeck（v0.6.6，MIT，553 stars，11.3 万行）
> 目的：对照 Pi Desktop 现状，提取可落地的借鉴项

## 1. 项目概况（代码级）

| 维度 | 详情 |
|---|---|
| 架构 | Electron + React；**一个 Agent Tab = 一个 `pi --mode rpc` 进程**（RPC 直连路线） |
| 主进程模块 | config(1149行)/sessions(5324行)/git(1254行)/pi-RPC(9190行)/terminal(341行)/ipc(3373行)/skills/prompts/feishu/wsl/browser |
| 渲染层 | 7.2 万行 React（Composer/会话/侧栏/工作区/终端/overlays） |
| 质量 | tests/ + e2e/（playwright）+ 中文 i18n（mainProcessCopy/rendererCopy） |

## 2. 可借鉴清单（按价值排序）

### 🟢 A. 配置可视化编辑器（高价值，补我们设置页短板）

**PiDeck 做法**（`src/main/config/ConfigManager.ts` + renderer config 弹窗）：
- `models.json`：Provider 卡片 + 模型网格 + **连接测试**（45s 超时，提示"超时不等于不支持"）
- `auth.json`：API Key 管理（掩码/测试）
- `settings.json`：类型感知键值编辑器 + 原始 JSON 双模式
- baseUrl 规范化建议（`suggestNormalizedBaseUrl`，含 OpenAI 兼容版本提示）

**我们的现状**：设置页只有诊断信息，不能编辑配置。用户改模型/密钥要靠手改 JSON。
**落地**：设置页加"配置"区块（models.json/settings.json 浏览+编辑+保存+备份；连接测试可选）。

### 🟢 B. 会话导入（用户实际可用：本机有 .claude/.codex 目录）

**PiDeck 做法**（`sessions/ClaudeSessionImporter.ts` / `CodexSessionImporter.ts`）：
- 扫描 `~/.claude/projects/<项目>/**/*.jsonl`、`~/.codex/sessions/*.jsonl`
- 解析（含 thinking 提取 `extractThinkingRaw`）→ 转换 → 复制到 `~/.pi/agent/sessions/`（导入副本）
- 项目右键"导入会话"→ 浏览/恢复
- 后台扫描协调器（`BackgroundScanCoordinator`）不阻塞 UI

**我们的现状**：无。用户机器上有 `.claude`、`.codex` 目录（历史会话可能有用）。
**落地**：工具菜单加"导入会话…"→ 扫描 Claude/Codex 会话 → 选择导入 → 复制为 pi 会话格式 → 侧边栏可见。

### 🟡 C. @ 文件引用补全（扩展现有斜杠补全体系）

**PiDeck 做法**：Composer 输入 `@` → 文件/项目建议 → 插入引用（渲染为 chip）。
**我们的现状**：preload 已有斜杠命令补全（v1.1.22 待发），注入模式现成。
**落地**：补全体系加 `@` 分支——从当前 cwd 扫文件/目录，选择后插入路径文本。（注：pi-web 输入框可能本身支持 @？需实测，若支持则跳过）

### 🟡 D. 提示词/技能商店入口

**PiDeck 做法**：prompts.chat + skills.sh 在线商店，浏览/详情/一键安装（写模板/技能文件）。
**我们的现状**：模板面板只能本地创建；插件面板可装 npm 包；无在线商店。
**落地**：模板面板加"从商店导入"（skills.sh 有公开 API？需验证）；或提示用户用 `pi skills add`（pi-web 的 skills/install API 已有）。

### 🟡 E. streamGate 流式世代闸门（存档为设计参考）

**PiDeck 做法**（`pi/streamGate.ts`）：abort 时 seal 当前 generation，要求先看到 abort 后的 `agent_settled` 才放行下一轮——防"停止后残留 delta"和"立刻重发串台"。
**我们的现状**：流式由 pi-web 处理（上游负责），壳层无此问题。
**落地**：不实施；**存档**——若未来做 P2-4 的 RPC 桥（自定义 UI），此设计是必需件。

### ⚪ 明确不做（场景不符）

| 功能 | 原因 |
|---|---|
| 多项目工作区（多 RPC 进程） | 与 pi-web 单实例架构冲突，改动 = 重写 |
| Git 面板（分支/历史/提交摘要） | pi-web 已有 git status/diff 基础，工作量大（1254行+UI），对话场景够用 |
| 终端回放 buffer | 我们终端 tab 独立容器天然保留 scrollback |
| WSL / 飞书 / 内置浏览器 / 宠物 | 场景不符 |

## 3. 结论

PiDeck 验证了两件事：
1. **P2-4 评估正确**：RPC 自建路线成本高（11 万行、2.5 个月、v0.6 仍早期），我们维持 pi-web 封装是对的
2. **它有几个真金白银的补充**：配置可视化（A）、会话导入（B）是**我们缺且用户实际可用的**；@ 引用（C）和商店（D）是低成本扩展；streamGate（E）存档

**建议实施顺序**：A（配置编辑）→ B（会话导入）→ C（@ 引用）→ D（商店，视 API 可行性）
