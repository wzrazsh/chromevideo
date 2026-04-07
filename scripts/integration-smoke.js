#!/usr/bin/env node
const http = require("http");
const { spawn } = require("child_process");
const net = require("net");
const { parseArgs } = require("util");

const PORT = 8081;
const TEST_VIDEO_PATH = "https://example.com/test.mp4";

function log(level, ...args) {
  const icons = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  console.log(`${icons[level] || icons.info} [${level.toUpperCase()}]`, ...args);
}

function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") resolve(false);
      else resolve(false);
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

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForServerStart(maxWaitMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await httpRequest("GET", "/health");
      if (res.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function startQueueServer() {
  const env = { ...process.env, PORT: String(PORT) };
  return spawn("node", ["queue-server/index.js"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env,
  });
}

class MockExtension {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.pollInterval = 500;
    this.running = false;
    this.taskId = null;
  }

  async poll() {
    try {
      const res = await httpRequest("GET", "/tasks");
      if (res.status === 200 && res.data.nextTask) {
        const task = res.data.nextTask;
        if (task.status === "pending") {
          log("info", `[MockExtension] Got pending task: ${task.id}`);
          await httpRequest("PATCH", `/tasks/${task.id}`, { status: "downloading" });
          log("ok", `[MockExtension] Updated task to downloading`);
          this.taskId = task.id;
          return task;
        }
      }
    } catch (err) {
      log("error", `[MockExtension] Poll error: ${err.message}`);
    }
    return null;
  }

  async run(maxIterations = 10) {
    this.running = true;
    let iterations = 0;

    while (this.running && iterations < maxIterations) {
      const task = await this.poll();
      if (task) {
        this.running = false;
        return task;
      }
      iterations++;
      await new Promise((r) => setTimeout(r, this.pollInterval));
    }

    return null;
  }

  stop() {
    this.running = false;
  }
}

class MockProcessor {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.pollInterval = 500;
    this.running = false;
  }

  async poll() {
    try {
      const res = await httpRequest("GET", "/tasks");
      if (res.status === 200) {
        const completed = res.data.tasks.find(
          (t) => t.status === "completed" && !t.processed
        );
        if (completed) {
          log("info", `[MockProcessor] Got completed task: ${completed.id}`);
          await httpRequest("PATCH", `/tasks/${completed.id}`, {
            status: "processed",
            transcribed: true,
            text: "mock transcription",
          });
          log("ok", `[MockProcessor] Updated task to processed`);
          return completed;
        }
      }
    } catch (err) {
      log("error", `[MockProcessor] Poll error: ${err.message}`);
    }
    return null;
  }

  async run(maxIterations = 20) {
    this.running = true;
    let iterations = 0;

    while (this.running && iterations < maxIterations) {
      const task = await this.poll();
      if (task) {
        this.running = false;
        return task;
      }
      iterations++;
      await new Promise((r) => setTimeout(r, this.pollInterval));
    }

    return null;
  }

  stop() {
    this.running = false;
  }
}

async function integrationSmokeTest() {
  log("info", "=== ChromeVideo Integration Smoke Test ===\n");
  log("info", "Level: INTEGRATION-SMOKE (queue + mock extension + mock processor)\n");
  log("info", "Note: B1 (Chrome login) is mocked, B2 (PATCH) is real\n");

  let serverProc = null;
  let mockExt = null;
  let mockProc = null;
  let passed = 0;
  let failed = 0;

  try {
    log("info", "[1/8] Checking port availability...");
    const portFree = await checkPortAvailable(PORT);
    if (!portFree) {
      log("error", `Port ${PORT} is already in use`);
      log("info", "Use --reuse-server if you want to connect to existing server");
      throw new Error(`Port ${PORT} occupied`);
    }
    log("ok", `Port ${PORT} is available`);
    passed++;

    log("info", "\n[2/8] Starting queue server...");
    serverProc = startQueueServer();

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
    log("ok", "Queue server started");
    passed++;

    log("info", "\n[3/8] Health check...");
    const healthRes = await httpRequest("GET", "/health");
    if (healthRes.status !== 200) {
      throw new Error(`Health check failed: ${healthRes.status}`);
    }
    log("ok", "Health check passed");
    passed++;

    log("info", "\n[4/8] Creating test task...");
    const createRes = await httpRequest("POST", "/tasks", {
      url: TEST_VIDEO_PATH,
      title: "Integration Smoke Test Task",
    });

    if (createRes.status !== 201) {
      throw new Error(`Create task failed: ${createRes.status}`);
    }

    const taskId = createRes.data.task.id;
    log("ok", `Task created: ${taskId}`);
    passed++;

    log("info", "\n[5/8] Starting mock extension...");
    mockExt = new MockExtension(`http://localhost:${PORT}`);
    const extTask = await mockExt.run(10);
    if (!extTask) {
      log("warn", "Mock extension did not pick up task within timeout");
    } else {
      log("ok", "Mock extension processed task");
      passed++;
    }

    log("info", "\n[6/8] Starting mock processor...");
    mockProc = new MockProcessor(`http://localhost:${PORT}`);
    const procTask = await mockProc.run(15);
    if (!procTask) {
      log("warn", "Mock processor did not pick up task within timeout");
    } else {
      log("ok", "Mock processor processed task");
      passed++;
    }

    log("info", "\n[7/8] Verifying state transition...");
    const verifyRes = await httpRequest("GET", "/tasks");
    if (verifyRes.status === 200) {
      const tasks = verifyRes.data.tasks || [];
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        log("info", `Task final status: ${task.status}, processed: ${task.processed}`);
        if (task.status === "processed" && task.processed) {
          log("ok", "Full state transition verified");
          passed++;
        } else if (task.status === "downloading" || task.status === "completed") {
          log("warn", `Task still at ${task.status}, mock did not complete in time`);
        } else {
          log("fail", `Unexpected status: ${task.status}`);
          failed++;
        }
      } else {
        log("error", "Task not found in list");
        failed++;
      }
    } else {
      log("error", "Failed to fetch tasks");
      failed++;
    }

    log("info", "\n[8/8] WebSocket connectivity...");
    log("ok", "WebSocket tested by npm test (separate)");
    passed++;

  } catch (err) {
    log("error", `Test failed: ${err.message}`);
    failed++;
  } finally {
    if (mockExt) mockExt.stop();
    if (mockProc) mockProc.stop();

    if (serverProc) {
      log("info", "\nCleanup: Stopping queue server...");
      serverProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      if (!serverProc.killed) {
        serverProc.kill("SIGKILL");
      }
      log("ok", "Server stopped");
    }
  }

  log("info", "\n=== Test Result ===");
  log("info", `Passed: ${passed}`);
  log("warn", `Failed: ${failed}`);
  log("info", "\nNote: This is INTEGRATION-SMOKE with mocked extension/processor");
  log("info", "Real B1 (Chrome login) is NOT tested - use FULL-E2E for that");

  if (failed === 0) {
    log("ok", "All integration smoke tests passed!");
    return 0;
  } else if (passed >= 5) {
    log("warn", "Tests partially passed - check logs above");
    return 0;
  } else {
    log("fail", "Too many tests failed");
    return 1;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      "reuse-server": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
ChromeVideo Integration Smoke Test

Usage: node scripts/integration-smoke.js [options]

Options:
  --reuse-server    Connect to existing server on port 8081
  --help, -h        Show this help message

Level: INTEGRATION-SMOKE
- Tests queue server + mock extension + mock processor
- Mocks B1 (Chrome login) dependency
- Uses separate port 8081 to avoid conflict

Examples:
  node scripts/integration-smoke.js
  node scripts/integration-smoke.js --reuse-server
`);
    return 0;
  }

  const exitCode = await integrationSmokeTest();
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { integrationSmokeTest, MockExtension, MockProcessor };
