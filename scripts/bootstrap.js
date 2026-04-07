#!/usr/bin/env node
const { execSync } = require("child_process");
const { existsSync } = require("fs");
const net = require("net");
const path = require("path");
const { parseArgs } = require("util");

const PORT = 8080;
const REQUIRED_ENV_VARS = [
  "ALIYUN_ACCESS_KEY",
  "ALIYUN_ACCESS_SECRET",
  "ALIYUN_APP_KEY",
];

function log(level, ...args) {
  const timestamp = new Date().toISOString();
  const icons = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  console.log(`[${timestamp}] ${icons[level] || icons.info} [${level.toUpperCase()}]`, ...args);
}

function checkCommand(cmd, name) {
  try {
    execSync(cmd, { stdio: "pipe" });
    log("ok", `${name}: installed`);
    return true;
  } catch {
    log("error", `${name}: not found`);
    return false;
  }
}

function checkPythonPackage(pkg) {
  try {
    execSync(`python -c "import ${pkg}"`, { stdio: "pipe" });
    log("ok", `Python ${pkg}: installed`);
    return true;
  } catch {
    log("warn", `Python ${pkg}: not installed`);
    return false;
  }
}

function checkEnvVar(name) {
  const value = process.env[name];
  if (value) {
    log("ok", `ENV ${name}: set`);
    return true;
  } else {
    log("warn", `ENV ${name}: not set`);
    return false;
  }
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log("warn", `Port ${port}: already in use (service may be running)`);
        resolve(false);
      } else {
        log("error", `Port ${port}: error - ${err.code}`);
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close();
      log("ok", `Port ${port}: available (can start service)`);
      resolve(true);
    });
    server.listen(port);
  });
}

function checkChromeProfile() {
  const possiblePaths = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data", "Default"),
    path.join(process.env.APPDATA || "", "Local", "Google", "Chrome", "User Data", "Default"),
  ];
  for (const profilePath of possiblePaths) {
    if (existsSync(profilePath)) {
      log("ok", `Chrome Profile: found at ${profilePath}`);
      return true;
    }
  }
  log("warn", "Chrome Profile: not found");
  return false;
}

async function healthCheck() {
  log("info", "=== ChromeVideo Environment Check ===\n");

  log("info", "-- Node.js & npm --");
  const nodeOk = checkCommand("node --version", "Node.js");
  const npmOk = checkCommand("npm --version", "npm");

  log("info", "\n-- Python --");
  const pythonOk = checkCommand("python --version", "Python");
  const requestsOk = checkPythonPackage("requests");

  log("info", "\n-- FFmpeg --");
  const ffmpegOk = checkCommand("ffmpeg -version", "FFmpeg");

  log("info", "\n-- Chrome --");
  const chromeOk = checkChromeProfile();

  log("info", "\n-- Aliyun Credentials --");
  const envResults = REQUIRED_ENV_VARS.map((v) => checkEnvVar(v));
  const allEnvSet = envResults.every(Boolean);

  log("info", "\n-- Queue Server Port --");
  const portAvailable = await checkPortAvailable(PORT);

  log("info", "\n=== Summary ===");

  const checks = {
    "Node.js": nodeOk,
    npm: npmOk,
    Python: pythonOk,
    FFmpeg: ffmpegOk,
    "Chrome Profile": chromeOk,
    "Aliyun Credentials": allEnvSet,
  };

  const criticalPassed = Object.entries(checks)
    .filter(([k]) => !["Aliyun Credentials"].includes(k))
    .filter(([, v]) => v).length;
  const criticalTotal = Object.keys(checks).filter((k) => !["Aliyun Credentials"].includes(k)).length;

  const optionalFailed = !allEnvSet;
  const portMsg = portAvailable ? "ready (can start)" : "occupied (service running or port blocked)";

  log("info", `\nCritical checks: ${criticalPassed}/${criticalTotal}`);
  if (optionalFailed) {
    log("warn", "Optional: Aliyun credentials not set (transcription will be skipped)");
  }
  log("info", `Queue port: ${portMsg}`);

  if (criticalPassed === criticalTotal) {
    log("ok", "All critical checks passed!");
    return 0;
  } else {
    log("error", "Some critical checks failed.");
    return 1;
  }
}

function startQueueServer() {
  log("info", "Starting queue server...");
  try {
    execSync("npm start", { stdio: "inherit", cwd: path.join(__dirname, "..") });
  } catch (err) {
    log("error", "Failed to start queue server");
    process.exit(1);
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      check: { type: "boolean", short: "c" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
ChromeVideo Bootstrap Script

Usage: node scripts/bootstrap.js [options]

Options:
  --check, -c    Only run health checks, don't start services
  --help, -h     Show this help message

Exit codes:
  0 = All critical checks passed
  1 = Some checks failed

Examples:
  node scripts/bootstrap.js --check   # Check environment only
  node scripts/bootstrap.js            # Check and start queue server
`);
    return 0;
  }

  if (values.check) {
    return await healthCheck();
  }

  await healthCheck();
  startQueueServer();
}

main().catch((err) => {
  log("error", err.message);
  process.exit(1);
});
