# 🚀🦊 Life After Code: GitLab Transcend Hackathon — Complete Devpost Submission Package

**Project Title:** ShipStory CI — GitLab Duo Merge Request Blast-Radius, Release Notes & 1-Click Rollback Studio  
**Tagline (<= 60 chars):** GitLab Duo MR blast-radius DAG, release notes & CI rollback.  
**Competition:** Life After Code: GitLab Transcend Hackathon (`$45,000` Prize Pool)  
**Local Studio Port:** `http://127.0.0.1:5182` (`strictPort: true`)

---

## 1. Inspiration

Writing code is only the first 20% of shipping software. In **"Life After Code"**, engineering teams lose hours on every high-risk GitLab Merge Request to three manual bottlenecks: figuring out the downstream blast radius of a schema or auth change, rewriting the same diff into separate briefs for SREs vs. customers without leaking internal file paths, and scrambling at 2:00 AM to assemble a safe rollback pipeline when a canary deployment degrades.

---

## 2. What It Does

1. **Interactive 3-Tier Dependency Blast-Radius Graph (`880×390` SVG DAG)**:
   - Parses unified `git diff` hunks across 4 realistic GitLab Merge Request scenarios (`!1482`, `!1509`, `!1514`, `!1521`) or custom pasted diffs, extracting SQL DDL migrations, environment variables, and service dependencies into a zero-overlap 3-tier SVG DAG with 1-click impact path isolation.
2. **Multi-Persona Release Notes & Privacy Sanitizer (`ReleaseNotesEngine`)**:
   - Simultaneously generates an **SRE On-Call Deployment Brief** (mathematically verified to retain 100% of SQL migrations, env vars, and SLA thresholds), a **Customer SemVer Changelog** (verified to scrub 100% of internal source file paths), and an **Executive SLA Impact Summary**.
3. **Deterministic 1-Click Rollback, GitLab Duo Custom Flow (`ai_catalog_flow/v1`) & GitLab MCP Server Payloads (`RollbackRunbookEngine`)**:
   - Synthesizes copy-ready `.gitlab-ci.yml` pipelines (`validate`, `canary_deploy` with `environment: action: start`, `blast_radius_gate`, and `auto_rollback` with `when: on_failure` & `environment: action: stop`), **GitLab Duo Agent Platform Custom Flow YAML (`ai_catalog_flow/v1`, `@gitlab-duo`)**, and **GitLab MCP Server JSON-RPC 2.0 tool payloads** (`get_merge_request_diffs`, `save_merge_request_review`, `execute_pipeline_rollback_job`).

---

## 3. How We Built It

- **Pure TypeScript DevSecOps Engines (`src/lib/`)**: `blast-radius-engine.ts`, `release-notes-engine.ts`, `rollback-runbook-engine.ts`, and `gitlab-ai-adapter.ts` (with `0ms` deterministic local mode + `4.5s` `AbortController` circuit breaker).
- **Root GitLab CI Pipeline & 6 Automated Verification Gates**: Verified via root [`.gitlab-ci.yml`](../.gitlab-ci.yml) and `npm test` (`6/6` gates passing in `~100ms`).

---

## 4. Challenges We Ran Into & Accomplishments

- **Balancing SRE Precision with Customer Path Privacy**: SREs need exact migration filenames (`20261027_ledger_idempotency.sql`) and env vars (`PAYMENT_IDEMPOTENCY_TTL_SEC`), whereas customer changelogs must never leak internal directory structures (`src/services/ledger/...`). Our `verifyArtifactPreservation()` gate enforces both invariants simultaneously on every MR.

---

## 5. "Built With" Tags

`gitlab`, `gitlab-ci`, `gitlab-duo`, `model-context-protocol`, `devsecops`, `typescript`, `react`, `vite`, `svg-dag`, `ast-analysis`

---

## 6. 90-Second Demo Video Narration Script

- **`0:00 – 0:25` · GitLab MR Blast-Radius DAG & Path Isolation**:
  - *Visual*: Open `http://127.0.0.1:5182`. Select MR `!1482` (*Ledger Idempotency Key & Unique Index Migration*) and click nodes on the 3-tier SVG Blast-Radius Graph to highlight downstream API and SLA dependencies.
- **`0:25 – 0:55` · Multi-Persona Release Notes & Token Preservation Gate**:
  - *Visual*: Switch between **SRE On-Call Brief**, **Customer SemVer Changelog**, and **Executive Brief**, highlighting the green **100% Critical Token Preservation** and **0 Internal Path Leaks** verification badges.
- **`0:55 – 1:30` · `.gitlab-ci.yml` Rollback, GitLab Duo Custom Flow & MCP Payloads**:
  - *Visual*: Switch across the **Rollback `.gitlab-ci.yml`**, **GitLab Duo Flow (`ai_catalog_flow/v1`)**, and **GitLab MCP Server Tools** tabs, demonstrating 1-click copy and FNV-1a-32 runbook attestation.
