# 任务计划：Pi Desktop 更新链路与内置组件升级

- [x] 阶段 1：升级内置 pi-web/Pi Agent 依赖并同步锁文件
- [x] 阶段 2：用失败测试锁定并修复 Release 相对下载地址
- [x] 阶段 3：运行完整测试与质量门检查
- [x] 阶段 4：构建目录/安装包并验证包内版本
- [x] 阶段 5：整理变更并交付独立分支

## 范围

- 修复 `electron/updater.js` 的 GitHub Release 相对资产 URL 解析。
- `@agegr/pi-web` 固定到 `0.8.11`。
- `@earendil-works/pi-coding-agent` 固定到 `0.84.3`。
- 本地测试与构建验证。

## 不在范围内

- 不发布 GitHub Release。
- 不安装到当前系统。
- 不修改独立 Pi CLI。
- 不改账号、会话、窗口和 pi-web 生命周期。
