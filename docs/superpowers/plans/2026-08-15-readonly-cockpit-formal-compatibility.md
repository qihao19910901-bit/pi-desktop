# 正式版兼容驾驶舱实施计划

- [ ] 阶段 1：在 `pi-desktop` 正式基线中加入驾驶舱纯模块和最小 main/preload 集成，并完成红测到绿测。
- [ ] 阶段 2：使用源码自身的 `build:dir` 构建，验证构建产物、依赖版本和资源清单。
- [ ] 阶段 3：在独立 user-data/端口下启动构建产物，验证 HTTP 200、Pi 页面和驾驶舱 DOM。
- [ ] 阶段 4：仅在独立 smoke 全部通过后，备份并可回滚替换正式客户端，完成正式 smoke。

## 范围边界

### 范围内

- `electron/cockpit-http.js`
- `electron/cockpit-snapshot.js`
- `electron/cockpit-workspace.js`
- `electron/cockpit-ui.js`
- `electron/cockpit-ui.css`
- `electron/main.js`
- `electron/preload.js`
- 相关测试、构建验证和正式客户端资源替换。

### 明确不在范围内

- `@agegr/pi-web` 源码和 API 行为改造。
- 0.84.1 依赖升级/降级。
- 用户数据、CRM 数据、API Key、workflow 执行和部署。
- 旧 1.1.0/Electron 36 测试包复用。

## 关键检查点

1. 先写针对正式 main/preload 集成的 failing test，确认它因缺少 cockpit 集成而失败。
2. 复制已验证纯模块并最小修改正式源码。
3. 运行驾驶舱测试和正式项目测试。
4. `npm run build:dir`。
5. 独立构建目录 smoke；失败不允许正式替换。
6. 备份→替换→启动→HTTP 200/DOM 验证→失败恢复。
