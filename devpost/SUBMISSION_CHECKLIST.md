# Devpost Submission Checklist — ShipStory CI (GitLab Transcend Hackathon)

- [x] **Standalone Repository**: `shipstory-ci`
- [x] **Strict Local Port**: `http://127.0.0.1:5182` (`strictPort: true`)
- [x] **Gate 1 — BlastRadiusEngine**: Parses unified git diffs, computes `0–100` risk scores, verifies `0` SVG node bounding-box overlaps across all 4 production MR scenarios and custom diffs, and isolates connected subgraphs.
- [x] **Gate 2 — ReleaseNotesEngine**: Verifies 100% critical token preservation (SQL migrations, env vars, thresholds) in SRE Deployment Briefs and 0 internal file path leaks in Customer SemVer Changelogs.
- [x] **Gate 3 — RollbackRunbookEngine**: Verifies `.gitlab-ci.yml` generation across all 4 required stages (`validate`, `canary_deploy`, `blast_radius_gate`, `auto_rollback`) with `when: on_failure` and `0` unresolved template placeholders.
- [x] **Gate 4 — GitLabAIAdapter**: Verifies 0ms offline deterministic pipeline execution and `AbortController` timeout fallback resilience under simulated network faults.
- [x] **Gate 5 & Gate 6 — Clean-Room & Port 5182 Audit**: Verifies zero proprietary terminology leakage and clean TypeScript + Vite production build (`dist/`).

- [x] **Root `.gitlab-ci.yml` & `LICENSE`**: 5-stage root GitLab CI pipeline and MIT open-source license verified on disk.
- [x] **GitLab Duo Custom Flow (`ai_catalog_flow/v1`) & MCP Tool Payloads**: Verified in Gate 3 (`duoCustomFlowYaml`, `mcpToolPayloads`, and `environment: action: start/stop`).
