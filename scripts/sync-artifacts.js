#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");
const LATEST_DIR = path.join(ARTIFACTS_DIR, "latest");

const REQUIRED_FILES = [
  "summary.md",
  "verification.txt",
  "blockers.json",
  "next-backlog.json",
  "commit.md",
];

function log(level, ...args) {
  const icons = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  console.log(`${icons[level] || icons.info} [${level.toUpperCase()}]`, ...args);
}

function findLatestRound() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    return null;
  }

  const entries = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.match(/^\d{4}-\d{2}-\d{2}-\d+$/))
    .map((e) => e.name)
    .sort()
    .reverse();

  for (const entry of entries) {
    const roundDir = path.join(ARTIFACTS_DIR, entry);
    const hasRequired = REQUIRED_FILES.every((f) =>
      fs.existsSync(path.join(roundDir, f))
    );
    if (hasRequired) {
      return entry;
    }
  }

  return entries.length > 0 ? entries[0] : null;
}

function getExtraFiles(roundDir) {
  const allFiles = fs.readdirSync(roundDir);
  const requiredSet = new Set(REQUIRED_FILES);
  return allFiles.filter((f) => !requiredSet.has(f) && f !== "commit.md");
}

function syncFromRound(roundId) {
  const roundDir = path.join(ARTIFACTS_DIR, roundId);
  const extraFiles = getExtraFiles(roundDir);

  log("info", `Syncing from ${roundId} to latest...\n`);

  if (!fs.existsSync(LATEST_DIR)) {
    fs.mkdirSync(LATEST_DIR, { recursive: true });
    log("info", "Created latest directory");
  }

  let success = true;

  for (const file of REQUIRED_FILES) {
    const src = path.join(roundDir, file);
    const dest = path.join(LATEST_DIR, file);

    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      log("ok", `Copied ${file}`);
    } else {
      log("error", `Missing required file: ${file} in ${roundId}`);
      success = false;
    }
  }

  for (const file of extraFiles) {
    const src = path.join(roundDir, file);
    const dest = path.join(LATEST_DIR, file);
    fs.copyFileSync(src, dest);
    log("ok", `Copied extra: ${file}`);
  }

  return success;
}

function validateLatest() {
  log("info", "\nValidating latest directory...\n");

  let valid = true;

  for (const file of REQUIRED_FILES) {
    const filePath = path.join(LATEST_DIR, file);
    if (!fs.existsSync(filePath)) {
      log("error", `Missing required file: ${file}`);
      valid = false;
    }
  }

  if (valid) {
    log("ok", "All required files present");
  } else {
    log("error", "Latest directory is incomplete");
  }

  return valid;
}

function main() {
  log("info", "=== ChromeVideo Artifacts Sync ===\n");

  const latestRound = findLatestRound();

  if (!latestRound) {
    log("error", "No round directories found in artifacts/");
    log("info", "Create at least one round directory with required files");
    process.exit(1);
  }

  log("info", `Latest round: ${latestRound}\n`);

  const success = syncFromRound(latestRound);

  if (success) {
    log("ok", "\nSync completed successfully");
    process.exit(0);
  } else {
    log("error", "\nSync failed: missing required files");
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { syncFromRound, validateLatest, findLatestRound };
