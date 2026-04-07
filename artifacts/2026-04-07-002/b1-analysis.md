# B1 Blocker 分析：B站 Chrome 登录态依赖

## 问题描述

Chrome 扩展 (`chromevideo/background.js`) 依赖本地已登录 B站的 Chrome 用户配置文件。扩展通过轮询 `http://localhost:8080/tasks` 获取任务，然后调用 B站接口下载视频。

**问题**：B站接口需要有效的登录态 Cookie，而 Chrome 的 Cookie 使用 Windows DPAPI 加密存储，无法在无 UI 环境下直接读取。

## 现有检查机制

已实现 `scripts/check-login.js`，但只能检查：
- Chrome Profile 路径是否存在
- Cookies 文件是否存在
- Login Data 文件是否存在

**无法验证**：用户是否真的已登录 B站

## 可行方案评估

### 方案 1：复用现有 Chrome Profile（当前方案）

**描述**：使用本地已登录的 Chrome Profile 启动扩展。

**优点**：
- 实现简单，无需额外开发
- 利用现有 Chrome 的登录态

**缺点**：
- 需要人工准备环境
- 无法在干净 CI 环境中运行
- 扩展必须与浏览器使用相同 Profile

**风险**：HIGH - 无法无人值守

**评估**：❌ 不满足全自动要求

---

### 方案 2：Selenium/Playwright 模拟登录

**描述**：使用 Playwright 或 Selenium 控制浏览器完成 B站登录，获取 Cookie 后存储。

**实现步骤**：
1. 创建 `scripts/bilibili-login.js`
2. 使用 Playwright 打开 B站登录页
3. 等待用户扫码/输入凭据
4. 提取 Cookie 并保存到文件
5. 扩展读取 Cookie 文件

**优点**：
- 半自动化，减少人工操作
- 可在 CI 中运行（需要人工输入一次性验证码）

**缺点**：
- 仍然需要人工干预（验证码）
- Cookie 有有效期，需要定期刷新

**风险**：MEDIUM - 首次需要人工，后续可自动

**评估**：⚠️ 部分满足，可作为过渡方案

---

### 方案 3：使用 B站 API 替代登录态

**描述**：研究 B站公开 API，看是否有不需要登录的接口获取视频信息。

**实现步骤**：
1. 分析 B站视频页面请求
2. 找到可用的公开接口
3. 修改扩展使用公开接口

**优点**：
- 无需登录态
- 可完全自动化

**缺点**：
- 可能无法获取需要登录才能观看的视频
- 可能违反 B站 ToS

**风险**：HIGH - 法律/合规风险

**评估**：❌ 不推荐

---

### 方案 4：Mock/Stub 扩展行为

**描述**：在测试时使用 Mock 扩展，模拟扩展行为进行验证。

**实现步骤**：
1. 创建 `scripts/mock-extension.js`
2. 模拟扩展的轮询、下载、状态更新行为
3. 用于 API-SMOKE 和 INTEGRATION-SMOKE

**优点**：
- 完全自动化
- 隔离外部依赖

**缺点**：
- 不测试真实扩展行为
- 可能遗漏扩展相关 bug

**风险**：LOW - 仅用于测试

**评估**：✅ 适合测试场景

---

### 方案 5：使用 Chrome Debugging Protocol

**描述**：通过 Chrome DevTools Protocol 访问已运行浏览器的 Cookie。

**实现步骤**：
1. 启动 Chrome 并启用远程调试
2. 使用 CDP 获取 Cookie
3. 存储并供扩展使用

**优点**：
- 可获取加密 Cookie
- 无需额外依赖

**缺点**：
- 需要先启动 Chrome
- CDP 获取的 Cookie 可能仍需解密

**风险**：MEDIUM - 实现复杂度高

**评估**：⚠️ 理论可行，实际操作复杂

---

## 推荐方案

### 短期（满足当前测试需求）

采用 **方案 4 (Mock/Stub)**：
- 实现 `scripts/mock-extension.js`
- 用于 API-SMOKE 和 INTEGRATION-SMOKE
- 将真实扩展测试限制在 FULL-E2E

### 长期（朝全自动努力）

采用 **方案 2 (Playwright 模拟登录)**：
- 首次运行时通过 Playwright 引导用户登录
- 定期刷新 Cookie
- 结合方案 4 用于无 GUI 环境

## Blocker B1 状态

| 方案 | 状态 | 适用场景 |
|------|------|----------|
| 方案 1: 复用 Profile | PARTIALLY_RESOLVED | 人工准备环境 |
| 方案 2: Playwright 登录 | 待实现 | 半自动化 |
| 方案 3: B站公开 API | 不推荐 | - |
| 方案 4: Mock/Stub | ✅ 可行 | 测试 |
| 方案 5: CDP | 复杂度高 | 探索 |

## 结论

B1 Blocker **无法完全消除**，因为：
1. B站登录态本质上是用户凭据
2. 需要人工交互（验证码）
3. Cookie 有有效期

**建议**：
- 在文档中明确标注 B1 需要人工准备
- 实现方案 2 作为半自动化方案
- 使用方案 4 隔离测试依赖
