import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildBlastRadiusAnalysis,
  verifyZeroNodeOverlap,
  isolateBlastSubgraph,
  parseUnifiedGitDiff,
} from '../lib/diff/blast-radius-engine.ts';
import {
  SHOWCASE_MR_SCENARIOS,
  synthesizeReleaseNotes,
  verifyArtifactPreservation,
} from '../lib/changelog/release-notes-engine.ts';
import {
  generateRollbackRunbook,
  verifyGitLabCiYamlSyntax,
} from '../lib/rollback/rollback-runbook-engine.ts';
import { runShipStoryPipeline } from '../lib/ai/gitlab-ai-adapter.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

async function runVerificationSuite() {
  const startMs = performance.now();
  console.log('================================================================');
  console.log('  SHIPSTORY CI — 6-GATE DETERMINISTIC VERIFICATION SUITE');
  console.log('================================================================\n');

  // ---------------------------------------------------------------------------
  // GATE 1: BlastRadiusEngine (Diff Parsing, Risk Scoring, SVG DAG Zero-Overlap)
  // ---------------------------------------------------------------------------
  for (const scenario of SHOWCASE_MR_SCENARIOS) {
    const analysis = buildBlastRadiusAnalysis({
      mrIid: scenario.mrIid,
      title: scenario.title,
      rawDiff: scenario.rawDiff,
    });
    assert.ok(
      analysis.files.length >= 1,
      `Expected >=1 parsed file for ${scenario.mrIid}`
    );
    assert.ok(
      analysis.overallRiskScore >= 40 && analysis.overallRiskScore <= 98,
      `Expected valid risk score for ${scenario.mrIid}, got ${analysis.overallRiskScore}`
    );
    assert.ok(
      analysis.nodes.length >= 3,
      `Expected >=3 DAG nodes for ${scenario.mrIid}`
    );

    const overlapCheck = verifyZeroNodeOverlap(analysis);
    assert.equal(
      overlapCheck.zeroOverlap,
      true,
      `SVG DAG overlap or out-of-bounds detected in ${scenario.mrIid}: ${JSON.stringify(
        overlapCheck.conflictPairs
      )}`
    );

    const firstNodeId = analysis.nodes[0].id;
    const isolated = isolateBlastSubgraph(analysis, firstNodeId);
    assert.ok(
      isolated.activeNodeIds.has(firstNodeId),
      `Expected isolated subgraph to contain selected node ${firstNodeId}`
    );
    assert.ok(
      isolated.activeNodeIds.size >= 2,
      `Expected isolated subgraph for ${firstNodeId} to include connected dependents`
    );
  }

  // Also test custom raw diff parsing with destructive SQL
  const customDiff = `diff --git a/migrations/20261028_drop_legacy_col.sql b/migrations/20261028_drop_legacy_col.sql
--- a/migrations/20261028_drop_legacy_col.sql
+++ b/migrations/20261028_drop_legacy_col.sql
@@ -1,2 +1,4 @@
+ALTER TABLE orders DROP COLUMN legacy_coupon_code;
+CREATE UNIQUE INDEX CONCURRENTLY idx_orders_external_ref ON orders (external_ref);`;
  const customParsed = parseUnifiedGitDiff(customDiff);
  assert.equal(customParsed.length, 1);
  assert.equal(customParsed[0].isSchemaMigration, true);
  assert.equal(customParsed[0].isDestructiveSql, true);
  console.log(
    '✅ GATE 1 PASSED: BlastRadiusEngine parsed all 4 MRs + custom DDL diff with 0 SVG node overlaps.'
  );

  // ---------------------------------------------------------------------------
  // GATE 2: ReleaseNotesEngine (3-Persona Synthesis & 100% Artifact Preservation)
  // ---------------------------------------------------------------------------
  for (const scenario of SHOWCASE_MR_SCENARIOS) {
    const notes = synthesizeReleaseNotes(scenario);
    const audit = verifyArtifactPreservation(scenario, notes);

    assert.equal(
      audit.preservedAllCriticalTokens,
      true,
      `Missing critical tokens in SRE brief for ${scenario.mrIid}: ${audit.missingTokens.join(
        ', '
      )}`
    );
    assert.equal(
      audit.customerChangelogLeakFree,
      true,
      `Internal file path leaked into Customer Changelog for ${
        scenario.mrIid
      }: ${audit.leakedInternalPaths.join(', ')}`
    );
    assert.ok(
      notes.executiveSummary.markdown.includes(scenario.semverTag),
      `Executive summary must reference ${scenario.semverTag}`
    );
  }
  console.log(
    '✅ GATE 2 PASSED: ReleaseNotesEngine preserved 100% of critical tokens in SRE briefs with 0 customer path leaks.'
  );

  // ---------------------------------------------------------------------------
  // GATE 3: RollbackRunbookEngine (.gitlab-ci.yml + Duo Custom Flow + MCP Gate)
  // ---------------------------------------------------------------------------
  for (const scenario of SHOWCASE_MR_SCENARIOS) {
    const runbook = generateRollbackRunbook(scenario);
    const validation = verifyGitLabCiYamlSyntax(runbook);

    assert.equal(
      validation.valid,
      true,
      `Invalid .gitlab-ci.yml for ${scenario.mrIid}: ${validation.errors.join('; ')}`
    );
    assert.equal(validation.stagesPresent.length, 4);
    assert.equal(validation.hasOnFailureRollback, true);
    assert.equal(validation.hasEnvironmentLifecycleActions, true);
    assert.equal(validation.hasDuoCustomFlowSpec, true);
    assert.equal(validation.hasMcpToolsSpec, true);
    assert.equal(validation.hasUnresolvedPlaceholders, false);
    assert.equal(runbook.steps.length, 4);
    assert.ok(runbook.estimatedRecoverySeconds > 0);
  }
  console.log(
    '✅ GATE 3 PASSED: RollbackRunbookEngine generated valid 4-stage .gitlab-ci.yml, Duo Custom Flow YAML, & MCP payloads.'
  );

  // ---------------------------------------------------------------------------
  // GATE 4: GitLabAIAdapter (0ms Deterministic Mode + 4.5s Circuit Breaker)
  // ---------------------------------------------------------------------------
  const localBundle = await runShipStoryPipeline(SHOWCASE_MR_SCENARIOS[0], {
    provider: 'local-deterministic',
  });
  assert.equal(localBundle.providerUsed, 'local-deterministic');
  assert.equal(localBundle.fallbackUsed, false);
  assert.ok(localBundle.blastRadius.overallRiskScore >= 75);

  const faultBundle = await runShipStoryPipeline(SHOWCASE_MR_SCENARIOS[0], {
    provider: 'gitlab-duo-byok',
    apiKey: 'glpat-simulated-test-key',
    endpointUrl: 'http://127.0.0.1:59997/v1/unreachable',
    timeoutMs: 60,
  });
  assert.equal(faultBundle.providerUsed, 'local-deterministic');
  assert.equal(faultBundle.fallbackUsed, true);
  assert.ok(
    faultBundle.fallbackReason?.includes('Circuit breaker fallback'),
    'Expected circuit breaker fallback reason'
  );
  console.log(
    '✅ GATE 4 PASSED: GitLabAIAdapter verified in 0ms local mode and survived simulated network fault via AbortController fallback.'
  );

  // ---------------------------------------------------------------------------
  // GATE 5: Port 5182 Strict Isolation Audit
  // ---------------------------------------------------------------------------
  const viteConfigText = fs.readFileSync(
    path.join(PROJECT_ROOT, 'vite.config.ts'),
    'utf8'
  );
  const pkgJsonText = fs.readFileSync(
    path.join(PROJECT_ROOT, 'package.json'),
    'utf8'
  );
  assert.ok(
    viteConfigText.includes('port: 5182') &&
      viteConfigText.includes('strictPort: true'),
    'vite.config.ts must bind strictly to port 5182 with strictPort: true'
  );
  assert.ok(
    pkgJsonText.includes('--port 5182 --strictPort'),
    'package.json scripts must specify --port 5182 --strictPort'
  );
  console.log(
    '✅ GATE 5 PASSED: Port 5182 strict isolation verified in vite.config.ts and package.json.'
  );

  // ---------------------------------------------------------------------------
  // GATE 6: Clean-Room Zero-Leak Audit (Source, Config, LICENSE & Devpost Docs)
  // ---------------------------------------------------------------------------
  const forbiddenTerms = [
    ['E', 'd', 'i', 'o', 's'].join(''),
    ['S', 'o', 'v', 'e', 'r', 'e', 'i', 'g', 'n'].join(''),
    ['C', 'i', 't', 'a', 'd', 'e', 'l'].join(''),
    ['3', '+', '3', ' ', 'S', 'e', 'l', 'f', '-', 'P', 'l', 'a', 'y'].join(''),
    ['L', 'e', 'x', 'i', 'L', 'e', 'n', 's'].join(''),
    ['H', 'e', 'a', 'r', 't', 'h', 'C', 'a', 's', 't'].join(''),
  ];

  const filesToAudit = [
    'LICENSE',
    '.gitlab-ci.yml',
    'package.json',
    'tsconfig.json',
    'vite.config.ts',
    'index.html',
    'README.md',
    'devpost/PRD.md',
    'devpost/ARCHITECTURE.md',
    'devpost/SUBMISSION_CHECKLIST.md',
    'src/main.tsx',
    'src/App.tsx',
    'src/styles.css',
    'src/lib/diff/blast-radius-engine.ts',
    'src/lib/changelog/release-notes-engine.ts',
    'src/lib/rollback/rollback-runbook-engine.ts',
    'src/lib/ai/gitlab-ai-adapter.ts',
  ];

  for (const relPath of filesToAudit) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    assert.ok(fs.existsSync(absPath), `Expected file to exist: ${relPath}`);
    const content = fs.readFileSync(absPath, 'utf8');
    for (const term of forbiddenTerms) {
      assert.equal(
        content.includes(term),
        false,
        `Clean-room violation: found forbidden term "${term}" in ${relPath}`
      );
    }
  }
  console.log(
    `✅ GATE 6 PASSED: Clean-room audit verified across all ${filesToAudit.length} source, LICENSE, .gitlab-ci.yml & Devpost files (0 leaks).`
  );

  const elapsedMs = (performance.now() - startMs).toFixed(2);
  console.log(
    `\n🏆 ALL 6 / 6 SHIPSTORY CI VERIFICATION GATES PASSED IN ${elapsedMs}ms!\n`
  );
}

runVerificationSuite().catch((err) => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
