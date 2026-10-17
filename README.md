# ShipStory CI — GitLab Merge Request Blast-Radius & Rollback Studio

**Built for the Life After Code: GitLab Transcend Hackathon ($45,000 Prize Pool)**

ShipStory CI is an automated GitLab DevSecOps companion that transforms unified git diffs and Merge Requests into:
1. **Interactive 3-Tier Dependency Blast-Radius Graphs (`880x390` SVG DAG)** mapping *Changed Source & DDL Migrations* → *Direct Service Dependents* → *Downstream API & SLA Consumers* with 1-click impact path isolation.
2. **Multi-Persona Release Notes & Customer Changelogs** that automatically sanitize internal file paths from customer-facing SemVer notes while preserving 100% of SQL migrations, environment variables, and numeric SLA thresholds in the SRE On-Call Deployment Brief.
3. **Deterministic 1-Click Rollback & `.gitlab-ci.yml` Runbooks** with validated `validate`, `canary_deploy`, `blast_radius_gate`, and `auto_rollback` (`when: on_failure`) jobs.
4. **0ms Offline Deterministic AST Engine + Optional GitLab Duo / BYOK AI Adapter** protected by a `4.5s` `AbortController` circuit breaker.

---

## Quick Start (Port `5182`)

```bash
# Run the 6-Gate Deterministic Verification Suite
npm test

# Typecheck + Run All 6 Gates
npm run check

# Launch Interactive Studio on http://127.0.0.1:5182
npm run dev
```

---

## Architecture & Verification Gates

- **Gate 1 (`BlastRadiusEngine`)**: Unified diff parsing, SQL DDL & env var extraction, 3-tier SVG DAG coordinate generation (`verifyZeroNodeOverlap`), and connected upstream/downstream subgraph isolation (`isolateBlastSubgraph`).
- **Gate 2 (`ReleaseNotesEngine`)**: 4 high-stakes production GitLab MR scenarios (`!1482`, `!1509`, `!1514`, `!1521`) + custom diff synthesis, verified for 100% critical token preservation in SRE briefs and 0 internal file path leaks in Customer Changelogs (`verifyArtifactPreservation`).
- **Gate 3 (`RollbackRunbookEngine`)**: Generates copy-ready `.gitlab-ci.yml` canary + automated rollback pipelines and 4-step incident revert checklists (`verifyGitLabCiYamlSyntax`).
- **Gate 4 (`GitLabAIAdapter`)**: Instant 0ms local deterministic mode for zero-key judge evaluation + `4.5s` `AbortController` timeout fallback (`runShipStoryPipeline`).
- **Gate 5 & Gate 6 (`Clean-Room & Port 5182 Isolation Audit`)**: Zero proprietary leakage and strict binding to `127.0.0.1:5182` (`strictPort: true`).
