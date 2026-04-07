# ChromeVideo 验证等级规范

## 概述

本项目采用三级验证体系，区分不同层次的测试能力和覆盖范围。

## 验证等级定义

### Level 1: API-SMOKE

**目的**: 验证队列服务 API 层的基本功能

**覆盖范围**:
- HTTP API 端点 (GET/POST/PATCH)
- WebSocket 连接
- 任务状态读写

**不覆盖**:
- Chrome 扩展
- process-video.py
- 真实视频下载
- 真实音频转写

**脚本**: `scripts/api-smoke.js`

**执行命令**: `node scripts/api-smoke.js`

**退出码语义**:
- 0 = 所有 API 测试通过
- 1 = 部分测试失败

**验证方式**: 直接 HTTP 请求到队列服务

---

### Level 2: INTEGRATION-SMOKE

**目的**: 验证组件间集成行为

**覆盖范围**:
- API-SMOKE 全部
- Chrome 扩展轮询和任务获取
- process-video.py 轮询和状态更新
- 完整的 pending → downloading → completed → processed 流转

**不覆盖**:
- B站实际登录态（需要人工准备）
- 真实视频下载（B站接口）
- 阿里云转写（需要凭据）

**脚本**: `scripts/integration-smoke.js` (待实现)

**执行命令**: `node scripts/integration-smoke.js`

**前置条件**:
- bootstrap.js --check 通过
- Chrome profile 存在
- 队列服务未运行

**验证方式**: 启动队列服务 + 扩展 + process-video.py，监控状态流转

---

### Level 3: FULL-E2E

**目的**: 验证完整业务链路

**覆盖范围**:
- INTEGRATION-SMOKE 全部
- B站真实登录态
- 真实视频下载
- 真实音频转写（可选）

**脚本**: `scripts/full-e2e.js` (待实现)

**执行命令**: `node scripts/full-e2e.js`

**前置条件**:
- INTEGRATION-SMOKE 通过
- 阿里云凭据已配置
- B站已登录（有有效 cookies）

**验证方式**: 端到端完整流程，监控从任务创建到结果输出的全过程

---

## 当前状态

| 等级 | 状态 | 脚本 |
|------|------|------|
| API-SMOKE | ✅ 已实现 | `scripts/api-smoke.js` |
| INTEGRATION-SMOKE | ⏳ 待实现 | `scripts/integration-smoke.js` |
| FULL-E2E | ⏳ 待实现 | `scripts/full-e2e.js` |

## 执行策略

1. **CI/CD 流程**: 每次提交强制执行 API-SMOKE
2. **集成验证**: 每次代码变更后执行 INTEGRATION-SMOKE
3. **发布验证**: 每次 release 前执行 FULL-E2E

## AGENTS.md 对应

根据 `AGENTS.md` 中的验证等级和自动化门槛规则：

- `npm test` 对应 API-SMOKE 级别
- `npx playwright test test-extension.spec.js` 对应 INTEGRATION-SMOKE 级别
- 完整的用户场景测试对应 FULL-E2E 级别

## Blocker 与验证等级关系

| Blocker | 影响等级 |
|---------|----------|
| B1: Chrome 登录态 | FULL-E2E |
| B2: PATCH 能力 | API-SMOKE (已修复) |
| B3: 编排脚本 | INTEGRATION-SMOKE |
| B5: 监控回灌 | FULL-E2E |
