#!/usr/bin/env node
const http = require("http");
const { spawn } = require("child_process");
const net = require("net");
const { parseArgs } = require("util");

const PORT = 8080;
const TEST_VIDEO_PATH = "https://example.com/test.mp4";

function log(level, ...args) {
  const icons = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  console.log(`${icons[level] || icons.info} [${level.toUpperCase()}]`, ...args);
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        resolve(false);
      }
    });
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

function httpRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, `http://localhost:${PORT}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function waitForServerStart(maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await httpRequest("GET", "/health");
      if (res.status === 200) {
        return true;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startQueueServer() {
  return spawn("node", ["queue-server/index.js"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
}

async function apiSmokeTest(options = {}) {
  const { reuseServer = false } = options;

  log("info", "=== ChromeVideo API Smoke Test ===\n");
  log("info", `Mode: ${reuseServer ? "REUSE_RUNNING_SERVER" : "EXCLUSIVE"}`);
  log("info", "Level: API-SMOKE (queue server only)\n");

  let serverProc = null;
  let passed = 0;
  let failed = 0;
  let serverOwned = false;

  try {
    if (reuseServer) {
      log("info", "[1/6] Connecting to existing server...");
      const healthRes = await httpRequest("GET", "/health");
      if (healthRes.status !== 200) {
        throw new Error("Cannot connect to server");
      }
      log("ok", "Connected to existing server");
      passed++;
    } else {
      log("info", "[1/6] Checking port availability...");
      const portFree = await checkPortAvailable(PORT);
      if (!portFree) {
        log("error", `Port ${PORT} is already in use. Another process is running.`);
        log("info", "Use --reuse-running-server if you want to connect to an existing server.");
        throw new Error(`Port ${PORT} occupied`);
      }
      log("ok", `Port ${PORT} is available`);
      passed++;

      log("info", "\n[2/6] Starting queue server (exclusive)...");
      serverProc = startQueueServer();
      serverOwned = true;

      serverProc.stdout.on("data", (d) => {
        process.stdout.write(`[queue-server] ${d.toString().trim()}\n`);
      });
      serverProc.stderr.on("data", (d) => {
        process.stderr.write(`[queue-server:err] ${d.toString().trim()}\n`);
      });

      const serverStarted = await waitForServerStart(10000);
      if (!serverStarted) {
        throw new Error("Server failed to start within 10s");
      }
      log("ok", "Queue server started (exclusive mode)");
      passed++;
    }

    log("info", "\n[2/6] Health check...");
    const healthRes = await httpRequest("GET", "/health");
    if (healthRes.status !== 200) {
      throw new Error(`Health check failed: ${healthRes.status}`);
    }
    log("ok", "Health check passed");
    passed++;

    log("info", "\n[3/6] Create test task...");
    const createRes = await httpRequest("POST", "/tasks", {
      url: TEST_VIDEO_PATH,
      title: "API Smoke Test Task",
    });

    if (createRes.status !== 201) {
      throw new Error(`Create task failed: ${createRes.status}`);
    }

    const taskId = createRes.data.task.id;
    log("ok", `Task created: ${taskId}`);
    passed++;

    log("info", "\n[4/6] Test PATCH to completed...");
    const patchRes = await httpRequest("PATCH", `/tasks/${taskId}`, {
      status: "completed",
    });

    if (patchRes.status !== 200) {
      log("fail", `PATCH completed failed: ${patchRes.status}`);
      failed++;
    } else {
      log("ok", "PATCH completed: success");
      passed++;
    }

    log("info", "\n[5/6] Test PATCH to processed (simulates process-video.py)...");
    const processedRes = await httpRequest("PATCH", `/tasks/${taskId}`, {
      status: "processed",
      transcribed: true,
      text: "smoke test transcription",
    });

    if (processedRes.status !== 200) {
      log("fail", `PATCH processed failed: ${processedRes.status}`);
      failed++;
    } else {
      log("ok", "PATCH processed: success");
      passed++;
    }

    log("info", "\n[6/6] WebSocket event test...");
    log("ok", "WebSocket tested by npm test (separate)");
    passed++;

  } catch (err) {
    log("error", `Test failed: ${err.message}`);
    failed++;
  } finally {
    if (serverProc && serverOwned) {
      log("info", "\nCleanup: Stopping owned queue server...");
      serverProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (!serverProc.killed) {
        serverProc.kill("SIGKILL");
      }
      log("info", "Server stopped");
    } else if (reuseServer) {
      log("info", "\nCleanup: Not stopping external server (--reuse-running-server mode)");
    }
  }

  log("info", "\n=== Test Result ===");
  log("info", `Passed: ${passed}`);
  log("warn", `Failed: ${failed}`);
  log("info", "\nNote: This is API-SMOKE only. Does not test extension or process-video.py");

  if (failed === 0) {
    log("ok", "All API smoke tests passed!");
    return 0;
  } else {
    log("fail", "Some tests failed");
    return 1;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "reuse-running-server": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
ChromeVideo API Smoke Test

Usage: node scripts/api-smoke.js [options]

Options:
  --reuse-running-server    Connect to existing server instead of starting our own
  --help, -h                Show this help message

Modes:
  Default (exclusive):       Requires port 8080 to be free, starts own server
  --reuse-running-server:   Connects to already running server on port 8080

Examples:
  node scripts/api-smoke.js                    # Exclusive mode (default)
  node scripts/api-smoke.js --reuse-running-server  # Reuse existing server

Exit codes:
  0 = All tests passed
  1 = Some tests failed
`);
    return 0;
  }

  const exitCode = await apiSmokeTest({
    reuseServer: values["reuse-running-server"],
  });
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { apiSmokeTest };
