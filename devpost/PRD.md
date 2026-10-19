# Product Requirements Document (PRD) — ShipStory CI

**Hackathon Track**: Life After Code: GitLab Transcend Hackathon  
**Product Name**: ShipStory CI — Automated Merge Request Blast-Radius Visualizer, Multi-Persona Release Notes & 1-Click Rollback Studio  
**Local Runtime Port**: `http://127.0.0.1:5182` (`strictPort: true`)

---

## 1. Problem Statement ("Life After Code")

Writing code is only the first 20% of shipping software. Once a developer opens a GitLab Merge Request, engineering teams lose hours to three manual, error-prone bottlenecks in **Life After Code**:
1. **Hidden Blast Radius**: Reviewers struggle to see how a 20-line diff (such as a Postgres `CREATE UNIQUE INDEX`, an Ed25519 JWT key rotation, or an Envoy ingress token-bucket change) cascades into downstream services and customer SLAs.
2. **Fragmented Release Communication**: Product managers need clean, customer-safe SemVer changelogs without internal file paths, while SREs on call need every environment variable, SQL migration filename, and numeric threshold preserved intact.
3. **High-Stress Rollbacks**: When a canary deployment trips an error budget at 2:00 AM, on-call engineers scramble to assemble `git revert`, `kubectl rollout`, and non-destructive SQL down-migration commands under pressure.

---

## 2. Solution Overview

**ShipStory CI** turns any GitLab Merge Request or pasted unified `git diff` into an interactive DevSecOps command center:
- **Engine 1 — 3-Tier SVG Dependency Blast-Radius Graph**: Parses unified git diffs to extract touched layers (`database`, `payment`, `auth`, `infra`, `api`), environment variables, and SQL DDL statements, rendering a zero-overlap 3-tier SVG DAG with 1-click upstream/downstream path isolation.
- **Engine 2 — Multi-Persona Release Notes Studio**: Simultaneously synthesizes:
  - **SRE & On-Call Deployment Brief** (100% preservation of SQL migrations, env vars, and SLA thresholds)
  - **Customer SemVer Changelog** (Keep-a-Changelog format with automated sanitization of internal source file paths)
  - **Executive & SLA Impact Brief**
- **Engine 3 — Deterministic 1-Click Rollback & `.gitlab-ci.yml` Generator**: Generates a validated 4-stage GitLab CI/CD pipeline (`validate`, `canary_deploy`, `blast_radius_gate`, `auto_rollback` with `when: on_failure` and `when: manual`) alongside a step-by-step recovery runbook with estimated recovery time in seconds.
- **Engine 4 — 0ms Deterministic AST + Optional BYOK AI Adapter**: Runs out-of-the-box in 0ms with zero API keys required for hackathon judges, while supporting optional BYOK / GitLab Duo synthesis protected by a `4.5s` `AbortController` circuit breaker.

- **Engine 3 — GitLab Duo Custom Flow (`ai_catalog_flow/v1`) & GitLab MCP Server Studio**: Emits copy-ready GitLab Duo Agent Platform custom flow YAML (`@gitlab-duo` MR mention trigger), JSON-RPC 2.0 GitLab MCP Server tool calls (`get_merge_request_diffs`, `save_merge_request_review`, `execute_pipeline_rollback_job`), and `.gitlab-ci.yml` `environment: action: start/stop` auto-rollback pipelines.
