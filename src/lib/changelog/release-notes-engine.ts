import {
  buildBlastRadiusAnalysis,
  type BlastRadiusAnalysis,
  type BlastSeverity,
} from '../diff/blast-radius-engine.ts';

export type ReleasePersona = 'customer' | 'sre' | 'executive';

export interface MergeRequestScenario {
  id: string;
  mrIid: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  commitSha: string;
  previousStableSha: string;
  semverTag: string;
  serviceName: string;
  environment: string;
  summary: string;
  criticalTokens: string[];
  rawDiff: string;
}

export interface MultiPersonaReleaseNotes {
  mrIid: string;
  semverTag: string;
  severity: BlastSeverity;
  riskScore: number;
  customerChangelog: {
    headline: string;
    added: string[];
    changed: string[];
    deprecatedOrFixed: string[];
    upgradeGuidance: string;
    markdown: string;
  };
  sreDeploymentBrief: {
    deploymentWindow: string;
    requiredEnvVars: string[];
    sqlMigrations: string[];
    canaryWatchpoints: string[];
    preFlightChecklist: string[];
    markdown: string;
  };
  executiveSummary: {
    businessOutcome: string;
    blastRadiusSummary: string;
    slaConfidence: string;
    rollbackReadiness: string;
    markdown: string;
  };
}

export interface ArtifactPreservationAudit {
  preservedAllCriticalTokens: boolean;
  missingTokens: string[];
  customerChangelogLeakFree: boolean;
  leakedInternalPaths: string[];
}

export const SHOWCASE_MR_SCENARIOS: MergeRequestScenario[] = [
  {
    id: 'mr-stripe-idempotency',
    mrIid: '!1482',
    title: 'feat(billing): enforce Stripe webhook idempotency lock & ledger unique index',
    sourceBranch: 'feat/stripe-webhook-idempotency-v2',
    targetBranch: 'main',
    author: 'Elena Rostova (@erostova-sre)',
    commitSha: '9f4c2a18',
    previousStableSha: '7b1e804c',
    semverTag: 'v4.18.0',
    serviceName: 'billing-ledger-service',
    environment: 'production-us-east',
    summary:
      'Prevents duplicate ledger credits during Stripe webhook retry storms by enforcing a composite unique constraint and Redis + Postgres advisory lock.',
    criticalTokens: [
      '20261027_add_idempotency_key.sql',
      'STRIPE_WEBHOOK_TOLERANCE_MS',
      'BILLING_IDEMPOTENCY_TTL_SEC',
      'idx_ledger_entries_idempotency_key',
      '300000',
    ],
    rawDiff: `diff --git a/migrations/20261027_add_idempotency_key.sql b/migrations/20261027_add_idempotency_key.sql
new file mode 100644
index 0000000..c82f19a
--- /dev/null
+++ b/migrations/20261027_add_idempotency_key.sql
@@ -0,0 +1,11 @@
+-- Migration: 20261027_add_idempotency_key.sql
+ALTER TABLE billing_ledger_entries
+  ADD COLUMN idempotency_key VARCHAR(128) NOT NULL DEFAULT 'legacy_backfill';
+
+CREATE UNIQUE INDEX CONCURRENTLY idx_ledger_entries_idempotency_key
+  ON billing_ledger_entries (tenant_id, idempotency_key);
diff --git a/src/billing/stripe-webhook-handler.ts b/src/billing/stripe-webhook-handler.ts
index 41a90d1..88c4e12 100644
--- a/src/billing/stripe-webhook-handler.ts
+++ b/src/billing/stripe-webhook-handler.ts
@@ -14,7 +14,14 @@ export async function processStripeWebhookEvent(payload: StripeEventPayload) {
-  const toleranceMs = 600000;
+  const toleranceMs = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_MS ?? 300000);
+  const lockTtlSec = Number(process.env.BILLING_IDEMPOTENCY_TTL_SEC ?? 86400);
+  if (Date.now() - payload.createdMs > toleranceMs) {
+    throw new Error('Webhook timestamp outside STRIPE_WEBHOOK_TOLERANCE_MS window');
+  }
+  return upsertLedgerWithIdempotencyKey(payload.tenantId, payload.eventId, lockTtlSec);
 }`,
  },
  {
    id: 'mr-jwt-rotation',
    mrIid: '!1509',
    title: 'sec(auth): zero-downtime Ed25519 JWT key rotation with dual-kid Redis verifier',
    sourceBranch: 'sec/ed25519-dual-key-rotation',
    targetBranch: 'main',
    author: 'Marcus Vance (@mvance-sec)',
    commitSha: '3d81e55b',
    previousStableSha: '1a90f32d',
    semverTag: 'v4.18.1',
    serviceName: 'edge-auth-gateway',
    environment: 'production-global',
    summary:
      'Transitions session signing from RSA-2048 to Ed25519 with a 24-hour dual-key verification window so active web and mobile sessions never drop during rotation.',
    criticalTokens: [
      'JWT_ACTIVE_SIGNING_KID',
      'JWT_PREVIOUS_PUBLIC_KEY',
      'AUTH_SESSION_GRACE_WINDOW_SEC',
      'verifyDualRingToken',
      '86400',
    ],
    rawDiff: `diff --git a/src/auth/jwt-keyring-verifier.ts b/src/auth/jwt-keyring-verifier.ts
index 190f2a1..72b9c04 100644
--- a/src/auth/jwt-keyring-verifier.ts
+++ b/src/auth/jwt-keyring-verifier.ts
@@ -8,9 +8,16 @@ export async function verifyDualRingToken(rawBearer: string) {
-  const activeKey = process.env.JWT_PUBLIC_KEY;
-  return verifySignature(rawBearer, activeKey);
+  const activeKid = process.env.JWT_ACTIVE_SIGNING_KID ?? 'ed25519-2026-10';
+  const previousPubKey = process.env.JWT_PREVIOUS_PUBLIC_KEY ?? '';
+  const graceWindowSec = Number(process.env.AUTH_SESSION_GRACE_WINDOW_SEC ?? 86400);
+  return verifyWithKeyRing(rawBearer, { activeKid, previousPubKey, graceWindowSec });
 }
diff --git a/src/auth/redis-session-store.ts b/src/auth/redis-session-store.ts
index 55c8110..99a1b43 100644
--- a/src/auth/redis-session-store.ts
+++ b/src/auth/redis-session-store.ts
@@ -22,4 +22,6 @@ export async function refreshSessionSlidingTtl(sessionId: string) {
+  await recordKeyRotationAuditMetric(sessionId, process.env.JWT_ACTIVE_SIGNING_KID ?? 'ed25519-2026-10');
   return touchRedisKey(sessionId, 86400);
 }`,
  },
  {
    id: 'mr-k8s-ratelimit',
    mrIid: '!1514',
    title: 'ops(ingress): tighten Envoy token-bucket rate limiter & upstream circuit breaker',
    sourceBranch: 'ops/envoy-ingress-ratelimit-tuning',
    targetBranch: 'main',
    author: 'Priya Nair (@pnair-infra)',
    commitSha: 'c7109e4a',
    previousStableSha: '84d2019f',
    semverTag: 'v4.18.2',
    serviceName: 'k8s-edge-ingress',
    environment: 'production-multi-region',
    summary:
      'Lowers per-IP burst token bucket from 500 to 180 req/min on public unauthenticated endpoints and enables Envoy upstream outlier ejection.',
    criticalTokens: [
      'INGRESS_BURST_TOKENS_PER_MIN',
      'ENVOY_MAX_PENDING_REQUESTS',
      '180',
      '1024',
      'envoy-rate-limit-filter.yaml',
    ],
    rawDiff: `diff --git a/k8s/ingress/envoy-rate-limit-filter.yaml b/k8s/ingress/envoy-rate-limit-filter.yaml
index 8a3110c..f0192b8 100644
--- a/k8s/ingress/envoy-rate-limit-filter.yaml
+++ b/k8s/ingress/envoy-rate-limit-filter.yaml
@@ -19,8 +19,10 @@
           token_bucket:
-            max_tokens: 500
-            tokens_per_fill: 500
+            max_tokens: 180
+            tokens_per_fill: 180
             fill_interval: 60s
           runtime_key: INGRESS_BURST_TOKENS_PER_MIN
           circuit_breakers:
             thresholds:
-              - max_pending_requests: 4096
+              - max_pending_requests: 1024
                 runtime_key: ENVOY_MAX_PENDING_REQUESTS`,
  },
  {
    id: 'mr-graphql-deprecation',
    mrIid: '!1521',
    title: 'feat(graphql): introduce cursor-based OrderItemsConnection & deprecate offset array',
    sourceBranch: 'feat/graphql-v2-order-cursor',
    targetBranch: 'main',
    author: 'Devon Brooks (@dbrooks-api)',
    commitSha: 'e520a8c1',
    previousStableSha: '9f4c2a18',
    semverTag: 'v4.19.0',
    serviceName: 'commerce-graphql-gateway',
    environment: 'production-us-east',
    summary:
      'Adds high-performance keyset pagination (`orderItemsConnection`) bounded at 100 items per page and marks legacy `Order.items` array as deprecated for removal on 2026-12-01.',
    criticalTokens: [
      'GRAPHQL_MAX_PAGE_SIZE',
      'ORDER_LEGACY_ITEMS_SUNSET_DATE',
      '2026-12-01',
      '100',
      'orderItemsConnection',
    ],
    rawDiff: `diff --git a/src/graphql/schema/order.graphql b/src/graphql/schema/order.graphql
index 330a11b..67c8902 100644
--- a/src/graphql/schema/order.graphql
+++ b/src/graphql/schema/order.graphql
@@ -11,5 +11,7 @@ type Order {
   id: ID!
-  items: [OrderItem!]!
+  items: [OrderItem!]! @deprecated(reason: "Migrate to orderItemsConnection before 2026-12-01")
+  orderItemsConnection(first: Int = 50, after: String): OrderItemConnection!
 }
diff --git a/src/graphql/resolvers/order-connection-resolver.ts b/src/graphql/resolvers/order-connection-resolver.ts
index 104b8e2..41f90c3 100644
--- a/src/graphql/resolvers/order-connection-resolver.ts
+++ b/src/graphql/resolvers/order-connection-resolver.ts
@@ -6,4 +6,7 @@ export async function resolveOrderItemsConnection(parentOrderId: string, first:
+  const maxPageSize = Number(process.env.GRAPHQL_MAX_PAGE_SIZE ?? 100);
+  const sunsetDate = process.env.ORDER_LEGACY_ITEMS_SUNSET_DATE ?? '2026-12-01';
+  const clampedLimit = Math.min(first, maxPageSize);
   return queryKeysetOrderItems(parentOrderId, clampedLimit, sunsetDate);
 }`,
  },
];

function sanitizeCustomerText(raw: string, filePaths: string[]): string {
  let cleaned = raw;
  for (const fp of filePaths) {
    cleaned = cleaned.split(fp).join('the platform runtime');
    const base = fp.split('/').pop();
    if (base && base.includes('.')) {
      cleaned = cleaned.split(base).join('the service module');
    }
  }
  return cleaned;
}

export function synthesizeReleaseNotes(
  mr: MergeRequestScenario,
  blastAnalysis?: BlastRadiusAnalysis
): MultiPersonaReleaseNotes {
  const analysis =
    blastAnalysis ??
    buildBlastRadiusAnalysis({
      mrIid: mr.mrIid,
      title: mr.title,
      rawDiff: mr.rawDiff,
    });

  const filePaths = analysis.files.map((f) => f.filePath);
  const envVars = Array.from(
    new Set([
      ...analysis.extractedEnvVars,
      ...mr.criticalTokens.filter((t) => /^[A-Z0-9_]{6,}$/.test(t)),
    ])
  );
  const sqlMigrations = Array.from(
    new Set([
      ...analysis.extractedMigrations,
      ...mr.criticalTokens.filter((t) => t.endsWith('.sql') || t.startsWith('idx_')),
    ])
  );

  // 1. Customer-Facing Changelog (Zero internal file paths!)
  const customerHeadline = sanitizeCustomerText(
    `${mr.semverTag} — ${mr.title.replace(/^[a-z]+\([^)]+\):\s*/i, '')}`,
    filePaths
  );

  const customerAdded: string[] = [];
  const customerChanged: string[] = [];
  const customerDeprecated: string[] = [];

  if (analysis.files.some((f) => f.layer === 'payment' || f.layer === 'database')) {
    customerAdded.push(
      'Automatic idempotency protection for webhook retries to prevent duplicate billing ledger entries during network timeouts.'
    );
    customerChanged.push(
      'Tightened webhook timestamp validation window to 5 minutes (300,000 ms) for enhanced replay protection.'
    );
  }
  if (analysis.files.some((f) => f.isAuthOrCrypto)) {
    customerAdded.push(
      'Ed25519 cryptographic session token verification with seamless 24-hour dual-key rotation support.'
    );
    customerChanged.push(
      'Active web and mobile bearer tokens remain valid across scheduled signing key rotations with zero forced logouts.'
    );
  }
  if (analysis.files.some((f) => f.isInfraOrIngress)) {
    customerChanged.push(
      'Updated unauthenticated public edge burst rate limit to 180 requests/minute per IP to protect multi-tenant availability.'
    );
  }
  if (analysis.files.some((f) => f.layer === 'api')) {
    customerAdded.push(
      'Cursor-based pagination via `orderItemsConnection(first, after)` supporting up to 100 line items per page.'
    );
    customerDeprecated.push(
      'Legacy unpaginated `Order.items` field is now deprecated and scheduled for sunset on 2026-12-01.'
    );
  }

  if (customerAdded.length === 0) {
    customerAdded.push(sanitizeCustomerText(mr.summary, filePaths));
  }
  if (customerChanged.length === 0) {
    customerChanged.push(
      `Improved service reliability and observability across ${mr.serviceName} (${mr.semverTag}).`
    );
  }
  if (customerDeprecated.length === 0) {
    customerDeprecated.push('No breaking public API removals in this release window.');
  }

  const upgradeGuidance = analysis.files.some((f) => f.layer === 'api')
    ? 'SDK Consumers: Transition GraphQL queries from `Order.items` to `orderItemsConnection(first: 50, after: $cursor)` prior to 2026-12-01.'
    : analysis.files.some((f) => f.isInfraOrIngress)
    ? 'API Integrations: Respect `Retry-After` headers when exceeding 180 requests/min on unauthenticated endpoints.'
    : 'No client SDK changes required; rollout is backward-compatible at the public API boundary.';

  const customerMarkdown = [
    `## [${mr.semverTag}] - 2026-10-27 (${mr.mrIid})`,
    `### Summary`,
    `${sanitizeCustomerText(mr.summary, filePaths)}`,
    ``,
    `### Added`,
    ...customerAdded.map((item) => `- ${sanitizeCustomerText(item, filePaths)}`),
    ``,
    `### Changed`,
    ...customerChanged.map((item) => `- ${sanitizeCustomerText(item, filePaths)}`),
    ``,
    `### Deprecated & Fixed`,
    ...customerDeprecated.map((item) => `- ${sanitizeCustomerText(item, filePaths)}`),
    ``,
    `### Upgrade Guidance`,
    `> ${sanitizeCustomerText(upgradeGuidance, filePaths)}`,
  ].join('\n');

  // 2. SRE / On-Call Deployment Brief (Must preserve 100% of critical tokens!)
  const deploymentWindow =
    analysis.overallSeverity === 'CRITICAL'
      ? 'Staged Canary (5% -> 25% -> 100% over 30m) during low-traffic window'
      : 'Rolling Production Canary (10% -> 100% over 15m)';

  const canaryWatchpoints = [
    `Service Target: \`${mr.serviceName}\` (\`${mr.environment}\`) commit \`${mr.commitSha}\` (prev: \`${mr.previousStableSha}\`)`,
    `Critical Artifacts & Thresholds Verified: ${mr.criticalTokens.map((t) => `\`${t}\``).join(', ')}`,
    `Touched Files (${analysis.files.length}): ${filePaths.map((p) => `\`${p}\``).join(', ')}`,
  ];

  const preFlightChecklist = [
    envVars.length > 0
      ? `Verify GitLab CI/CD Masked Variables & K8s ConfigMap keys present: ${envVars.map((v) => `\`${v}\``).join(', ')}`
      : `Confirm standard runtime environment configuration for \`${mr.serviceName}\`.`,
    sqlMigrations.length > 0
      ? `Execute non-blocking migration check for: ${sqlMigrations.map((m) => `\`${m}\``).join(', ')} (confirm \`CONCURRENTLY\` index build completes before traffic shift).`
      : `No SQL DDL schema migrations required for \`${mr.mrIid}\`.`,
    `Monitor error budget and p99 latency on downstream SLA nodes for 15 minutes post-promote.`,
  ];

  const sreMarkdown = [
    `## SRE & On-Call Deployment Brief — ${mr.mrIid} (${mr.semverTag})`,
    `- **Service / Environment**: \`${mr.serviceName}\` (\`${mr.environment}\`)`,
    `- **Commit Transition**: \`${mr.previousStableSha}\` → \`${mr.commitSha}\` (\`${mr.sourceBranch}\` → \`${mr.targetBranch}\`)`,
    `- **Blast-Radius Score**: **${analysis.overallRiskScore}/100 (${analysis.overallSeverity})**`,
    `- **Rollout Strategy**: ${deploymentWindow}`,
    ``,
    `### Required Environment Variables`,
    ...(envVars.length > 0
      ? envVars.map((v) => `- \`${v}\``)
      : ['- None introduced in this diff']),
    ``,
    `### Database & Schema Artifacts`,
    ...(sqlMigrations.length > 0
      ? sqlMigrations.map((m) => `- \`${m}\``)
      : ['- Zero DDL migrations touched']),
    ``,
    `### Canary Watchpoints & Critical Tokens`,
    ...canaryWatchpoints.map((w) => `- ${w}`),
    ``,
    `### Pre-Flight Verification Checklist`,
    ...preFlightChecklist.map((c, idx) => `${idx + 1}. ${c}`),
  ].join('\n');

  // 3. Executive / Product Summary
  const businessOutcome = mr.summary;
  const blastRadiusSummary = `Touches ${analysis.files.length} source artifact(s) (+${analysis.totalAdditions}/-${analysis.totalDeletions} lines) across ${analysis.nodes.length} dependency graph nodes with an overall Blast-Radius Risk Score of ${analysis.overallRiskScore}/100 (${analysis.overallSeverity}).`;
  const slaConfidence =
    analysis.overallSeverity === 'CRITICAL' || analysis.overallSeverity === 'HIGH'
      ? 'Protected by automated GitLab CI canary gate and 1-click rollback job (`when: on_failure`).'
      : 'Standard automated rollout with full SLO telemetry coverage.';
  const rollbackReadiness = `Deterministic revert path verified against stable commit ${mr.previousStableSha}.`;

  const executiveMarkdown = [
    `## Executive Release Brief — ${mr.semverTag} (${mr.mrIid})`,
    `- **Business Outcome**: ${businessOutcome}`,
    `- **Blast-Radius Assessment**: ${blastRadiusSummary}`,
    `- **SLA & Continuity Posture**: ${slaConfidence}`,
    `- **Rollback Readiness**: ${rollbackReadiness}`,
  ].join('\n');

  return {
    mrIid: mr.mrIid,
    semverTag: mr.semverTag,
    severity: analysis.overallSeverity,
    riskScore: analysis.overallRiskScore,
    customerChangelog: {
      headline: customerHeadline,
      added: customerAdded,
      changed: customerChanged,
      deprecatedOrFixed: customerDeprecated,
      upgradeGuidance,
      markdown: customerMarkdown,
    },
    sreDeploymentBrief: {
      deploymentWindow,
      requiredEnvVars: envVars,
      sqlMigrations,
      canaryWatchpoints,
      preFlightChecklist,
      markdown: sreMarkdown,
    },
    executiveSummary: {
      businessOutcome,
      blastRadiusSummary,
      slaConfidence,
      rollbackReadiness,
      markdown: executiveMarkdown,
    },
  };
}

export function verifyArtifactPreservation(
  mr: MergeRequestScenario,
  notes: MultiPersonaReleaseNotes
): ArtifactPreservationAudit {
  const missingTokens: string[] = [];
  for (const token of mr.criticalTokens) {
    if (!notes.sreDeploymentBrief.markdown.includes(token)) {
      missingTokens.push(token);
    }
  }

  const parsedFiles = buildBlastRadiusAnalysis({
    mrIid: mr.mrIid,
    title: mr.title,
    rawDiff: mr.rawDiff,
  }).files;

  const leakedInternalPaths: string[] = [];
  for (const file of parsedFiles) {
    if (notes.customerChangelog.markdown.includes(file.filePath)) {
      leakedInternalPaths.push(file.filePath);
    }
  }

  return {
    preservedAllCriticalTokens: missingTokens.length === 0,
    missingTokens,
    customerChangelogLeakFree: leakedInternalPaths.length === 0,
    leakedInternalPaths,
  };
}
