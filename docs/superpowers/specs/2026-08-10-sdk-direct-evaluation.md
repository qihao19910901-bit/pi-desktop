# Pi SDK 直连评估 — 自建 UI vs 当前 pi-web 封装

> 日期：2026-08-10
> 状态：评估完成（P2-4）
> 依据：`基恩知识库/05-技术资料/Pi Desktop 差距分析报告.md` P2-4

## 1. 结论（先说）

**维持当前方案（pi-web 封装），不转向 SDK 自建。** 理由：
1. pi-web 本身就是"SDK 直连"的成熟参考实现——自建 UI 不是"更底层"，而是"重写一遍 pi-web"
2. SDK 能力（会话/模型/扩展/技能/模板）与 pi-web 完全同源，不存在"直连更强大"
3. 自建成本 = 维护一个完整 Web UI 项目（会话树/模型管理/文件浏览/git/权限/流式渲染），数百小时级
4. 当前架构已有"UI 可替换"的演进路径：桌面壳自研模块（设置/插件/模板/终端）正在积累，pi-web 只负责核心对话 UI

## 2. SDK 能力盘点（官方文档 sdk.md/rpc.md）

| 能力 | SDK API | 说明 |
|---|---|---|
| 会话 | `createAgentSession()` / `AgentSession` | prompt/steer/followUp/subscribe/abort/compact |
| 运行时 | `ModelRuntime` | 模型加载、API key、OAuth |
| 会话存储 | `SessionManager` | 文件系统/内存，含分支树 |
| 配置 | `SettingsManager` | compaction/retry 等 |
| 资源 | `DefaultResourceLoader` | 扩展/技能/模板/主题/上下文文件 |
| 自定义 | `defineTool()` / 扩展 API | 工具、命令、事件、渲染器 |
| 模式 | `InteractiveMode` / `runPrintMode` | 终端/打印模式 |
| 协议 | **RPC 模式**（rpc.md，JSONL） | prompt/steer/get_state/get_messages/set_model 等命令 |

**关键事实**：SDK 的 `createAgentSession` 就是 pi-web 正在用的同一套 API（asar 内 server 代码 import `@earendil-works/pi-coding-agent`，用 SessionManager/SettingsManager/DefaultPackageManager）。

## 3. pi-web 已实现的 UI 能力（自建需要重做的部分）

| 模块 | 复杂度 | 自建工作量（估） |
|---|---|---|
| 会话列表/树/分支/compaction 交互 | 高 | 3-5 周 |
| 模型管理（providers/models/API key/OAuth/测试） | 高 | 2-3 周 |
| 流式消息渲染（thinking/工具调用/富文本） | 高 | 2-4 周 |
| 文件浏览器 + 项目信任流程 | 中 | 1-2 周 |
| 技能/插件/模板管理界面 | 中 | 1-2 周 |
| git 集成（status/diff） | 中 | 1 周 |
| 主题/国际化 | 低 | 0.5-1 周 |
| **合计** | | **约 3-4 人月** |

## 4. 三条路径对比

| 路径 | 成本 | 收益 | 风险 |
|---|---|---|---|
| **A. 维持 pi-web 封装（现状）** | 低（CI 自动更新 + 壳层增强） | UI 成熟、功能免费跟上游 | pi-web 上游停止维护/大改版（低概率，0.8.x 持续迭代中） |
| **B. SDK 自建 UI** | 3-4 人月一次性 + 持续维护 | 完全掌控 UI  | 重复造轮子；上游 SDK 变动同样要跟 |
| **C. RPC 模式接入（轻量）** | 1-2 周 | 第三方工具/脚本可调 pi | 只适合"调起"场景，不适合完整桌面 UI |

**建议：A 为主**，保留 C 作为扩展点（未来可给桌面壳加"RPC 桥"让外部脚本调 agent，见第 6 节）。

## 5. 为什么"直连 SDK"不解决当前任何痛点

当前桌面壳的痛点（中文化、面板缺失、更新、终端）**全部在 UI/壳层**，SDK 直连不改变任何一项：
- 中文化 → 壳层 preload 字典（已解决）
- 插件/模板管理 → 壳层面板（已解决）
- 更新/诊断 → 壳层（已解决）
- 终端 → 壳层（已解决）

SDK 直连只在一种情况下有意义：**pi-web 上游不可用**（停止维护/UI 与需求严重不符）。届时路径 B 的起点不是零——壳层已有 4 个自研面板 + preload 体系可复用。

## 6. 可选演进（低成本，暂不实施）

1. **RPC 桥**：桌面壳暴露本地 RPC 端点（复用 pi 的 rpc-entry），外部脚本/工具可调 agent——扩展性增强，1-2 周
2. **UI 层抽象**：把"pi-web URL"抽象为可配置的 UI 提供方（现在已是：main.js 直接 loadURL(PIWEB_URL)）——已天然支持替换

## 7. 结论存档

- 本评估结论：**维持 pi-web 封装，不立项 SDK 自建**
- 触发重估的条件：pi-web 停止维护超过 2 个版本周期，或上游 UI 方向重大变化
- P2-4 关闭
