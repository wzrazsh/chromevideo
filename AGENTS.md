# ChromeVideo Agents Guide

## Purpose

This file is the stable rulebook for agents working in this repository.

It should contain:

- stable architecture facts
- execution and verification rules
- task and artifact contracts
- collaboration boundaries

It should not contain:

- hand-maintained current blocker tables
- hand-maintained current priorities
- round-specific progress claims

Dynamic state must live in `artifacts/latest/`.

## Runtime Source Of Truth

Before planning or changing code, agents should read the latest runtime state from:

- `artifacts/latest/summary.md`
- `artifacts/latest/verification.txt`
- `artifacts/latest/blockers.json`
- `artifacts/latest/next-backlog.json`

Read additional files only when relevant:

- `artifacts/latest/commit.md`
- `artifacts/latest/b1-analysis.md`

Rules:

- Treat `artifacts/latest/` as the current project status.
- Treat `artifacts/<round-id>/` as immutable history.
- Do not rewrite `AGENTS.md` just to update current blockers or current priorities.

## Repository Layout

```text
E:\workspace\chromevideo
├── queue-server/           # Node.js HTTP/WebSocket queue service
├── chromevideo/            # Chrome extension (Manifest V3)
├── data/                   # Runtime state
│   ├── tasks.json
│   ├── results/
│   └── downloads/
├── scripts/                # Bootstrap, smoke, and workflow support scripts
├── artifacts/              # Execution artifacts and evolving project state
├── process-video.py        # Python post-processor
├── test-extension.spec.js  # Playwright extension bootstrap test
└── start-browser.js        # Persistent Chrome launcher
```

Key components:

| Component | Path | Role |
|---|---|---|
| Queue server | `queue-server/index.js` | Task API, persistence, WebSocket broadcast |
| Chrome extension | `chromevideo/background.js` | Poll queue, fetch Bilibili resources, download media |
| Python processor | `process-video.py` | Extract audio, optionally transcribe, persist processed results |
| Bootstrap checks | `scripts/bootstrap.js` | Validate local runtime prerequisites |
| API smoke | `scripts/api-smoke.js` | Verify queue-server API level behavior |

## Commands

Core commands:

```bash
npm test
npm start
node scripts/bootstrap.js --check
node scripts/api-smoke.js
node start-browser.js
npx playwright test test-extension.spec.js --timeout=1200000
python process-video.py
```

Notes:

- `npm test` verifies queue-server behavior.
- `node scripts/bootstrap.js --check` verifies critical local prerequisites.
- `node scripts/api-smoke.js` is API-SMOKE only. It does not validate extension or `process-video.py`.
- `node start-browser.js` launches Chrome with the extension using a persistent local profile.
- `npx playwright test test-extension.spec.js --timeout=1200000` is used to start the extension in Playwright.

## Queue API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/tasks` | Return all tasks and next pending task |
| `POST` | `/tasks` | Add a task `{ url }` |
| `PATCH` | `/tasks/:id` | Update task state or metadata |
| `POST` | `/results` | Report task result `{ taskId, status, text }` |
| `GET` | `/results/:taskId` | Fetch stored task result |
| `WS` | `/ws` | Task change notifications |
| `GET` | `/health` | Health check |

Task lifecycle:

```text
pending -> downloading -> processing -> completed -> processed
                  \-> failed
```

## Environment Constraints

This repository currently assumes:

- Windows
- PowerShell
- Local Chrome installation
- A persistent Chrome profile
- `ffmpeg` available on `PATH`
- Python with `requests`

Networking & Ports:

- `8080`: Node.js HTTP/WebSocket queue service.
- `9222`: Chrome remote debugging port.
- The extension polls `http://localhost:8080/tasks` to fetch new jobs.

Bilibili-specific constraints:

- The extension depends on a local Chrome profile that is already logged in.
- Manifest V3 service worker cannot use `fs` or `require()`.
- Downloads are performed via `chrome.downloads.download()`.

Aliyun configuration, when transcription is needed:

```powershell
$env:ALIYUN_ACCESS_KEY="your_key"
$env:ALIYUN_ACCESS_SECRET="your_secret"
$env:ALIYUN_APP_KEY="your_app_key"
```

## Verification Levels

The project uses three validation levels:

| Level | Meaning | Current implementation |
|---|---|---|
| API-SMOKE | Queue-server API and state mutation only | `scripts/api-smoke.js` |
| INTEGRATION-SMOKE | Queue server + extension + processor integration | not yet implemented |
| FULL-E2E | Real business flow including external dependencies | not yet implemented |

Rules:

- Do not label API-only verification as E2E.
- Direct `PATCH` simulation of downstream components is not sufficient for INTEGRATION-SMOKE or FULL-E2E.
- `PASS` requires both exit code `0` and acceptance criteria to be satisfied.
- `PARTIAL` means some useful signal was produced, but acceptance was not fully met.
- `FAIL` means the result is not trustworthy due to command failure, cleanup failure, port conflict, missing critical step, or similar instability.

Reference:

- `scripts/verification-levels.md`

## Agent Operating Rules

All agents should follow these rules:

1. Read code and runtime state before editing.
2. Define acceptance before implementation.
3. Do not claim completion without verification.
4. If blocked by environment or credentials, produce a blocker report instead of pretending success.
5. Convert repeated manual work into scripts, tests, or artifact generation.
6. Prefer updating executable workflow assets over adding prose-only explanations.

## Development State Machine

Use this state model for autonomous work:

```text
Backlog
  -> Ready
  -> Implementing
  -> Verifying
  -> Integrated
  -> Released
  -> Observed
  -> Evolved

Any stage
  -> Blocked
  -> Retry
```

State meanings:

| State | Meaning |
|---|---|
| `Backlog` | New need, defect, regression, or runtime issue has been captured |
| `Ready` | Scope, acceptance, and dependencies are clear |
| `Implementing` | Code or scripts are being changed |
| `Verifying` | Tests, checks, or smoke flows are being executed |
| `Integrated` | Local change passed its intended verification level |
| `Released` | Change is merged or ready for normal use |
| `Observed` | Runtime results, failures, and gaps are being reviewed |
| `Evolved` | A follow-up improvement was produced from observation |
| `Blocked` | Progress requires credentials, environment, or missing infrastructure |
| `Retry` | Verification failed and the task is re-entering implementation |

## Standard Execution Loop

Each autonomous round should follow this order:

1. Discovery
2. Planning
3. Implementation
4. Verification
5. Integration
6. Observation
7. Evolution

Execution rules by phase:

- Discovery: read relevant code, tests, logs, and `artifacts/latest/`.
- Planning: define goal, scope, acceptance, commands, and expected artifacts.
- Implementation: stay inside allowed boundaries unless explicitly justified.
- Verification: run the strongest practical level for the change; do not stop at prose claims.
- Integration: verify the change did not break surrounding components or contracts.
- Observation: record what passed, what failed, and whether the failure was code, environment, or workflow related.
- Evolution: generate follow-up work when a repeated manual step, flaky validation, or missing script is discovered.

## Work Item Contract

Each autonomous work item must include:

| Field | Meaning |
|---|---|
| `id` | Globally unique task identifier |
| `kind` | `implementation` or `analysis` |
| `title` | Short goal |
| `scope` | Allowed files or modules |
| `goal` | Expected behavior change |
| `acceptance` | Completion condition |
| `commands` | Verification commands |
| `artifacts` | Required output files |
| `blockers` | Known dependencies or blockers |

Rules:

- `id` must be globally unique across rounds.
- Do not reuse an `id` for a materially different task.
- `implementation` tasks must include both `acceptance` and `commands`.
- `analysis` tasks may omit commands, but must declare explicit artifact outputs.
- Do not mark a task complete if it violates this contract.

## Automation Readiness Gate

Do not promote the repository from `partial automation` to `automation-ready` unless all of the following are true:

1. `npm test` passes repeatably.
2. Queue server, extension, and Python processor can be started in scripted form.
3. `completed -> processed` works in the real system path, not only in isolated simulation.
4. At least one non-manual end-to-end smoke flow exists, and it does not rely only on direct `PATCH` simulation in place of real components.
5. Required environment dependencies are checked by script.
6. Each round produces structured verification artifacts.

## Artifact Contract

Expected structure:

```text
artifacts/
  latest/
    summary.md
    verification.txt
    blockers.json
    next-backlog.json
    commit.md
```

Rules:

- `artifacts/<round-id>/` is immutable round history.
- `artifacts/latest/` must be a complete mirror of the most recent round.
- `summary.md` records what changed and the current automation conclusion.
- `verification.txt` records commands, exit codes, and result grading.
- `blockers.json` records active and resolved blockers with status.
- `next-backlog.json` records only unfinished or newly generated work.
- `commit.md` records changed files and verification summary.

Additional rules:

- `next-backlog.json` must not repeat tasks completed in the same round.
- `next-backlog.json` task ids must not reuse ids from completed work.
- Analysis tasks must be explicitly marked as analysis tasks, not disguised as executable implementation items.

## Backlog Generation Rules

The following events must generate or update backlog items:

- new test failures
- new runtime exceptions
- repeated manual steps
- code and documentation drift
- nondeterministic failures caused by environment dependencies
- interrupted end-to-end flows
- unstable validation scripts such as wrong exit-code semantics, cleanup failures, port conflicts, or false positives

Prioritization order:

1. restore broken main-path behavior
2. fix validation-system trustworthiness
3. reduce manual dependencies
4. improve observability and evolution loops
5. optimize performance or developer experience

## Documentation Rules

- Do not maintain hand-written current progress tables in stable rule documents.
- Derive current progress from verification artifacts and backlog state.
- If a task is only `PARTIAL`, explicitly state which verification chain is missing.
- Keep dynamic blocker lists and current priorities in `artifacts/latest/`, not in `AGENTS.md`.

## Agent Roles And Boundaries

Recommended roles:

| Agent | Scope | Default write boundary |
|---|---|---|
| Orchestrator | planning, synthesis, artifact updates | `AGENTS.md`, `artifacts/`, project-level docs |
| Queue Agent | queue-server behavior | `queue-server/**` |
| Extension Agent | extension logic | `chromevideo/**` |
| Processor Agent | Python processing flow | `process-video.py` |
| Integration Agent | validation and orchestration scripts | `scripts/**`, `start-browser.js`, `test-extension.spec.js` |

Rules:

- Default to staying inside your boundary.
- Cross-boundary changes require explicit justification in artifacts or final summary.
- Integration work should expose system gaps and verify fixes; it should not silently redefine business behavior.

## Automation Status Policy

Status labels must be conservative:

- `partial automation`: current default until stronger evidence exists
- `automation-ready`: only after repeatable scripted validation exists for the required system level
- `full automation + evolutionary development`: only after blockers are reduced and verification is repeatable across rounds

Do not upgrade status labels based on optimism or partial simulations.
