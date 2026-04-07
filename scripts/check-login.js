#!/usr/bin/env node
const { existsSync } = require("fs");
const path = require("path");

function log(level, ...args) {
  const icons = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  console.log(`${icons[level] || icons.info} [${level.toUpperCase()}]`, ...args);
}

function checkBilibiliLogin() {
  log("info", "=== B站登录态检查 ===\n");

  const possiblePaths = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data", "Default"),
    path.join(process.env.APPDATA || "", "Local", "Google", "Chrome", "User Data", "Default"),
  ];

  let profilePath = null;
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      profilePath = p;
      log("ok", `Chrome Profile: ${profilePath}`);
      break;
    }
  }

  if (!profilePath) {
    log("error", "Chrome Profile 未找到");
    return false;
  }

  const cookiesPath = path.join(profilePath, "Network", "Cookies");
  const legacyCookiesPath = path.join(profilePath, "Cookies");

  if (existsSync(cookiesPath) || existsSync(legacyCookiesPath)) {
    log("ok", "Cookies 文件存在");
    log("warn", "注意: Chrome Cookies 是加密存储的，无法直接读取");
    log("info", "验证方式:");
    log("info", "  1. 手动打开 Chrome 访问 bilibili.com");
    log("info", "  2. 确认已登录状态");
    log("info", "  3. 扩展会使用同一 profile 的 cookies");
  } else {
    log("warn", "Cookies 文件不存在");
  }

  const loginStateFiles = [
    path.join(profilePath, "Login Data"),
    path.join(profilePath, "Login Data For Account"),
  ];

  let hasLoginData = false;
  for (const f of loginStateFiles) {
    if (existsSync(f)) {
      log("ok", `Login Data: ${path.basename(f)} 存在`);
      hasLoginData = true;
    }
  }

  if (!hasLoginData) {
    log("warn", "未找到 Login Data 文件");
  }

  console.log("\n=== 结论 ===");
  console.log("B站登录态依赖 Chrome Profile 完整性。");
  console.log("Chrome 使用 Windows DPAPI 加密敏感数据。");
  console.log("无法在无 UI 环境下自动验证登录态。\n");
  console.log("建议:");
  console.log("  1. 确保使用的 Chrome profile 已登录 B站");
  console.log("  2. 在首次运行时手动验证扩展能获取任务");
  console.log("  3. 考虑记录登录状态到独立配置文件\n");

  return profilePath !== null;
}

if (require.main === module) {
  const success = checkBilibiliLogin();
  process.exit(success ? 0 : 1);
}

module.exports = { checkBilibiliLogin };
