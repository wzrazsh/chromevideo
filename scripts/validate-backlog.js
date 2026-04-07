#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");
const LATEST_DIR = path.join(ARTIFACTS_DIR, "latest");
const BACKLOG_FILE = path.join(LATEST_DIR, "next-backlog.json");

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

function getAllCompletedIds() {
  const completedIds = new Set();

  if (!fs.existsSync(ARTIFACTS_DIR)) {
    return completedIds;
  }

  const entries = fs.readdirSync(ARTIFACTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.match(/^\d{4}-\d{2}-\d{2}-\d+$/));

  for (const entry of entries) {
    const commitFile = path.join(ARTIFACTS_DIR, entry.name, "commit.md");
    if (fs.existsSync(commitFile)) {
      const content = fs.readFileSync(commitFile, "utf-8");
      const match = content.match(/## Completed This Round[\s\S]*?(?=##|$)/i);
      if (match) {
        const completedSection = match[0];
        const idMatches = completedSection.match(/BL-\d+/g);
        if (idMatches) {
          idMatches.forEach((id) => completedIds.add(id));
        }
      }
    }
  }

  return completedIds;
}

function validateBacklogItem(item, index) {
  const errors = [];

  if (!item.id || !item.id.match(/^BL-\d+$/)) {
    errors.push(`[${index}] Missing or invalid id`);
  }

  if (!item.title || typeof item.title !== "string") {
    errors.push(`[${index}] Missing or invalid title`);
  }

  if (!item.scope || !Array.isArray(item.scope)) {
    errors.push(`[${index}] Missing or invalid scope`);
  }

  if (!item.goal || typeof item.goal !== "string") {
    errors.push(`[${index}] Missing or invalid goal`);
  }

  const isAnalysis = item.kind === "analysis";
  const hasCommands = Array.isArray(item.commands) && item.commands.length > 0;

  if (!isAnalysis && !hasCommands) {
    errors.push(`[${index}] Missing commands (or set kind: 'analysis')`);
  }

  if (isAnalysis && !item.artifacts) {
    errors.push(`[${index}] Analysis task missing artifacts path`);
  }

  return errors;
}

function validateBacklog(backlog, completedIds) {
  const errors = [];

  for (let i = 0; i < backlog.length; i++) {
    const item = backlog[i];

    if (completedIds.has(item.id)) {
      errors.push(`[${i}] ${item.id} already completed, should not be in backlog`);
    }

    const itemErrors = validateBacklogItem(item, i);
    errors.push(...itemErrors);
  }

  return errors;
}

function main() {
  log("info", "=== Backlog Validator ===\n");

  if (!fs.existsSync(BACKLOG_FILE)) {
    log("error", "No next-backlog.json found");
    process.exit(1);
  }

  let backlogData;
  try {
    backlogData = JSON.parse(fs.readFileSync(BACKLOG_FILE, "utf-8"));
  } catch (err) {
    log("error", `Failed to parse next-backlog.json: ${err.message}`);
    process.exit(1);
  }

  const { backlog = [], generated } = backlogData;

  log("info", `Generated: ${generated}`);
  log("info", `Items in backlog: ${backlog.length}\n`);

  const completedIds = getAllCompletedIds();
  log("info", `Completed IDs across all rounds: ${[...completedIds].join(", ") || "none"}\n`);

  const errors = validateBacklog(backlog, completedIds);

  if (errors.length === 0) {
    log("ok", "Backlog validation passed!");
    log("info", "\nBacklog items:");
    for (const item of backlog) {
      const isAnalysis = item.kind === "analysis";
      const hasCommands = Array.isArray(item.commands) && item.commands.length > 0;
      const type = isAnalysis ? "[analysis]" : hasCommands ? "[implementation]" : "[MISSING commands]";
      log("info", `  ${item.id}: ${item.title} ${type}`);
    }
    process.exit(0);
  } else {
    log("error", "Backlog validation failed:");
    for (const err of errors) {
      log("error", `  - ${err}`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateBacklog, getAllCompletedIds };
