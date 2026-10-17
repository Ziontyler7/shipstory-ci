export type BlastSeverity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

export type BlastLayer =
  | 'database'
  | 'auth'
  | 'payment'
  | 'infra'
  | 'api'
  | 'worker'
  | 'core';

export type DagTier = 'changed_source' | 'direct_dependent' | 'downstream_sla';

export interface DiffFileSummary {
  filePath: string;
  layer: BlastLayer;
  additions: number;
  deletions: number;
  isDestructiveSql: boolean;
  isSchemaMigration: boolean;
  isAuthOrCrypto: boolean;
  isInfraOrIngress: boolean;
  extractedEnvVars: string[];
  extractedSqlStatements: string[];
  extractedSymbols: string[];
}

export interface BlastNode {
  id: string;
  label: string;
  sublabel: string;
  tier: DagTier;
  layer: BlastLayer;
  riskScore: number;
  severity: BlastSeverity;
  x: number;
  y: number;
  width: number;
  height: number;
  metricsBadge: string;
}

export interface BlastEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  criticalPath: boolean;
}

export interface BlastRadiusAnalysis {
  mrIid: string;
  title: string;
  files: DiffFileSummary[];
  totalAdditions: number;
  totalDeletions: number;
  overallRiskScore: number;
  overallSeverity: BlastSeverity;
  riskFactors: string[];
  extractedEnvVars: string[];
  extractedMigrations: string[];
  nodes: BlastNode[];
  edges: BlastEdge[];
  svgWidth: number;
  svgHeight: number;
}

export interface NodeOverlapVerification {
  zeroOverlap: boolean;
  conflictPairs: Array<[string, string]>;
  withinCanvasBounds: boolean;
}

const SVG_WIDTH = 880;
const SVG_HEIGHT = 390;
const NODE_WIDTH = 224;
const NODE_HEIGHT = 68;

const TIER_X: Record<DagTier, number> = {
  changed_source: 32,
  direct_dependent: 328,
  downstream_sla: 624,
};

function classifyFileLayer(filePath: string, diffChunk: string): BlastLayer {
  const lower = filePath.toLowerCase();
  if (
    lower.includes('migration') ||
    lower.endsWith('.sql') ||
    lower.includes('schema') ||
    lower.includes('prisma')
  ) {
    return 'database';
  }
  if (
    lower.includes('auth') ||
    lower.includes('jwt') ||
    lower.includes('session') ||
    lower.includes('token') ||
    lower.includes('crypto')
  ) {
    return 'auth';
  }
  if (
    lower.includes('stripe') ||
    lower.includes('billing') ||
    lower.includes('payment') ||
    lower.includes('ledger') ||
    lower.includes('webhook')
  ) {
    return 'payment';
  }
  if (
    lower.includes('k8s') ||
    lower.includes('ingress') ||
    lower.includes('envoy') ||
    lower.includes('helm') ||
    lower.includes('terraform') ||
    lower.includes('gitlab-ci') ||
    lower.includes('ratelimit')
  ) {
    return 'infra';
  }
  if (
    lower.includes('graphql') ||
    lower.includes('resolver') ||
    lower.includes('router') ||
    lower.includes('controller') ||
    lower.includes('api')
  ) {
    return 'api';
  }
  if (lower.includes('worker') || lower.includes('queue') || lower.includes('job')) {
    return 'worker';
  }
  if (/ALTER\s+TABLE|CREATE\s+UNIQUE\s+INDEX|DROP\s+COLUMN/i.test(diffChunk)) {
    return 'database';
  }
  return 'core';
}

export function scoreToSeverity(score: number): BlastSeverity {
  if (score >= 78) return 'CRITICAL';
  if (score >= 55) return 'HIGH';
  if (score >= 30) return 'MODERATE';
  return 'LOW';
}

export function parseUnifiedGitDiff(rawDiff: string): DiffFileSummary[] {
  const normalized = rawDiff.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const chunks = normalized.split(/(?=^diff --git )/m).filter((c) => c.trim().length > 0);
  const summaries: DiffFileSummary[] = [];

  for (const chunk of chunks) {
    const headerMatch = chunk.match(/^diff --git a\/([^\s]+) b\/([^\s]+)/m);
    const plusFileMatch = chunk.match(/^\+\+\+ b\/([^\n]+)/m);
    const filePath = headerMatch
      ? headerMatch[2].trim()
      : plusFileMatch
      ? plusFileMatch[1].trim()
      : 'src/modified-module.ts';

    const lines = chunk.split('\n');
    let additions = 0;
    let deletions = 0;
    const envVars = new Set<string>();
    const sqlStatements = new Set<string>();
    const symbols = new Set<string>();

    for (const line of lines) {
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')) {
        continue;
      }
      const isAdded = line.startsWith('+');
      const isRemoved = line.startsWith('-');
      if (isAdded) additions += 1;
      if (isRemoved) deletions += 1;

      if (isAdded || isRemoved) {
        const content = line.slice(1);

        // Extract env vars (e.g. STRIPE_WEBHOOK_TOLERANCE_MS, JWT_PREVIOUS_PUBLIC_KEY)
        const envMatches = content.matchAll(/\b([A-Z][A-Z0-9_]{6,})\b/g);
        for (const m of envMatches) {
          const candidate = m[1];
          if (
            candidate.includes('_') &&
            !['ALTER_TABLE', 'CREATE_INDEX', 'NOT_NULL', 'PRIMARY_KEY', 'FOREIGN_KEY', 'DEFAULT', 'CONCURRENTLY'].includes(candidate) &&
            !/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|VARCHAR|BIGINT|BOOLEAN|TIMESTAMP)/.test(candidate)
          ) {
            envVars.add(candidate);
          }
        }

        // Extract SQL DDL patterns
        const sqlMatch = content.match(
          /\b(ALTER\s+TABLE\s+[a-zA-Z0-9_.]+|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?\s+[a-zA-Z0-9_.]+|DROP\s+COLUMN\s+[a-zA-Z0-9_.]+|ADD\s+COLUMN\s+[a-zA-Z0-9_.]+)/i
        );
        if (sqlMatch) {
          sqlStatements.add(sqlMatch[1].replace(/\s+/g, ' ').trim());
        }

        // Extract exported functions, classes, GraphQL fields, or YAML keys
        const fnMatch = content.match(
          /(?:export\s+(?:async\s+)?function\s+|export\s+const\s+|export\s+interface\s+|class\s+)([a-zA-Z0-9_]+)/
        );
        if (fnMatch) {
          symbols.add(fnMatch[1]);
        }
        const gqlDeprecated = content.match(/@deprecated\s*\(\s*reason:\s*"([^"]+)"\s*\)/);
        if (gqlDeprecated) {
          symbols.add(`@deprecated(${gqlDeprecated[1]})`);
        }
      }
    }

    const layer = classifyFileLayer(filePath, chunk);
    const isSchemaMigration =
      layer === 'database' || sqlStatements.size > 0 || filePath.endsWith('.sql');
    const isDestructiveSql =
      /DROP\s+COLUMN|DROP\s+TABLE|ALTER\s+COLUMN.*TYPE|NOT\s+NULL\s*(?!DEFAULT)/i.test(chunk);
    const isAuthOrCrypto =
      layer === 'auth' || /Ed25519|verifyToken|JWT_|rotateKey|sessionStore/i.test(chunk);
    const isInfraOrIngress =
      layer === 'infra' || /rate_limit|local_rate_limit|circuit_breakers|max_requests/i.test(chunk);

    summaries.push({
      filePath,
      layer,
      additions,
      deletions,
      isDestructiveSql,
      isSchemaMigration,
      isAuthOrCrypto,
      isInfraOrIngress,
      extractedEnvVars: Array.from(envVars),
      extractedSqlStatements: Array.from(sqlStatements),
      extractedSymbols: Array.from(symbols),
    });
  }

  return summaries;
}

function computeTierYPositions(count: number): number[] {
  if (count <= 0) return [];
  const topMargin = 28;
  const bottomMargin = 28;
  const usableHeight = SVG_HEIGHT - topMargin - bottomMargin;
  if (count === 1) {
    return [Math.round((SVG_HEIGHT - NODE_HEIGHT) / 2)];
  }
  const totalNodesHeight = count * NODE_HEIGHT;
  const gap = Math.max(16, Math.floor((usableHeight - totalNodesHeight) / (count - 1)));
  const totalSpan = totalNodesHeight + gap * (count - 1);
  const startY = Math.max(16, Math.round((SVG_HEIGHT - totalSpan) / 2));

  return Array.from({ length: count }, (_, idx) => startY + idx * (NODE_HEIGHT + gap));
}

function deriveDependentsForLayer(file: DiffFileSummary, index: number): {
  dependent: { id: string; label: string; sublabel: string; layer: BlastLayer; riskScore: number; badge: string };
  downstream: { id: string; label: string; sublabel: string; layer: BlastLayer; riskScore: number; badge: string };
  edgeLabel1: string;
  edgeLabel2: string;
} {
  const shortName = file.filePath.split('/').pop() || file.filePath;
  switch (file.layer) {
    case 'database':
      return {
        dependent: {
          id: `dep-db-${index}`,
          label: 'Postgres Billing & Ledger ORM',
          sublabel: file.extractedSqlStatements[0] || `Schema lock on ${shortName}`,
          layer: 'database',
          riskScore: file.isDestructiveSql ? 92 : 84,
          badge: file.isDestructiveSql ? 'DDL LOCK RISK' : 'MIGRATION GATE',
        },
        downstream: {
          id: `sla-db-${index}`,
          label: 'Checkout & Settlement API SLA',
          sublabel: '99.99% Write Availability Tier',
          layer: 'payment',
          riskScore: 88,
          badge: 'P0 FINANCIAL SLA',
        },
        edgeLabel1: 'DDL / Index Lock',
        edgeLabel2: 'Write Path Coupling',
      };
    case 'payment':
      return {
        dependent: {
          id: `dep-pay-${index}`,
          label: 'Webhook Idempotency Worker',
          sublabel: file.extractedSymbols[0] || 'Redis + DB Dedup Coordinator',
          layer: 'payment',
          riskScore: 86,
          badge: 'EXACTLY-ONCE GUARD',
        },
        downstream: {
          id: `sla-pay-${index}`,
          label: 'Stripe Event Ingestion Gateway',
          sublabel: 'POST /v1/webhooks/stripe (p99 < 150ms)',
          layer: 'api',
          riskScore: 85,
          badge: 'EXTERNAL WEBHOOK',
        },
        edgeLabel1: 'Idempotency Key',
        edgeLabel2: 'Retry Backoff Contract',
      };
    case 'auth':
      return {
        dependent: {
          id: `dep-auth-${index}`,
          label: 'Edge JWT Verifier & Redis Store',
          sublabel: file.extractedSymbols[0] || 'Dual-Key Kid Ring Lookup',
          layer: 'auth',
          riskScore: 89,
          badge: 'ZERO-DROP AUTH',
        },
        downstream: {
          id: `sla-auth-${index}`,
          label: 'Authenticated API & WebSockets',
          sublabel: 'All Bearer-Protected Client Sessions',
          layer: 'api',
          riskScore: 91,
          badge: 'GLOBAL SESSION SLA',
        },
        edgeLabel1: 'Public Key Ring',
        edgeLabel2: 'Session Continuity',
      };
    case 'infra':
      return {
        dependent: {
          id: `dep-infra-${index}`,
          label: 'Envoy Ingress Filter Chain',
          sublabel: 'Token-Bucket & Circuit Breaker Pool',
          layer: 'infra',
          riskScore: 76,
          badge: 'INGRESS POLICY',
        },
        downstream: {
          id: `sla-infra-${index}`,
          label: 'Public Edge Traffic & 429 Budget',
          sublabel: 'Multi-Region Ingress Load Balancer',
          layer: 'api',
          riskScore: 74,
          badge: 'EDGE TRAFFIC',
        },
        edgeLabel1: 'x-ratelimit Header',
        edgeLabel2: 'Upstream Spillover',
      };
    case 'api':
      return {
        dependent: {
          id: `dep-api-${index}`,
          label: 'GraphQL Federation Gateway',
          sublabel: file.extractedSymbols[0] || 'Cursor Connection Resolver',
          layer: 'api',
          riskScore: 68,
          badge: 'SCHEMA CONTRACT',
        },
        downstream: {
          id: `sla-api-${index}`,
          label: 'Web & Mobile SDK Clients',
          sublabel: 'v1 Legacy + v2 Cursor Consumers',
          layer: 'api',
          riskScore: 64,
          badge: 'CLIENT COMPATIBILITY',
        },
        edgeLabel1: 'Field Resolver',
        edgeLabel2: 'Deprecation Window',
      };
    default:
      return {
        dependent: {
          id: `dep-core-${index}`,
          label: 'Domain Service Orchestrator',
          sublabel: `Imports ${shortName}`,
          layer: file.layer,
          riskScore: 58,
          badge: 'INTERNAL MODULE',
        },
        downstream: {
          id: `sla-core-${index}`,
          label: 'Production API & Worker Mesh',
          sublabel: 'Standard SLO Telemetry Boundary',
          layer: 'api',
          riskScore: 54,
          badge: 'SERVICE SLO',
        },
        edgeLabel1: 'Module Import',
        edgeLabel2: 'Runtime Call Graph',
      };
  }
}

export function buildBlastRadiusAnalysis(params: {
  mrIid: string;
  title: string;
  rawDiff: string;
}): BlastRadiusAnalysis {
  const parsedFiles = parseUnifiedGitDiff(params.rawDiff);
  const files: DiffFileSummary[] =
    parsedFiles.length > 0
      ? parsedFiles
      : [
          {
            filePath: 'src/service/handler.ts',
            layer: 'core',
            additions: 12,
            deletions: 4,
            isDestructiveSql: false,
            isSchemaMigration: false,
            isAuthOrCrypto: false,
            isInfraOrIngress: false,
            extractedEnvVars: [],
            extractedSqlStatements: [],
            extractedSymbols: ['handleRequest'],
          },
        ];

  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

  const allEnvVars = Array.from(new Set(files.flatMap((f) => f.extractedEnvVars)));
  const allMigrations = Array.from(
    new Set(
      files.flatMap((f) =>
        f.isSchemaMigration
          ? [f.filePath.split('/').pop() || f.filePath, ...f.extractedSqlStatements]
          : f.extractedSqlStatements
      )
    )
  );

  const riskFactors: string[] = [];
  let baseScore = 28;

  if (files.some((f) => f.isSchemaMigration)) {
    baseScore += 28;
    riskFactors.push('Database DDL / schema migration detected in merge request.');
  }
  if (files.some((f) => f.isDestructiveSql)) {
    baseScore += 16;
    riskFactors.push('Non-nullable or lock-sensitive SQL constraint alteration.');
  }
  if (files.some((f) => f.isAuthOrCrypto)) {
    baseScore += 26;
    riskFactors.push('Authentication / cryptographic token verification path modified.');
  }
  if (files.some((f) => f.layer === 'payment')) {
    baseScore += 24;
    riskFactors.push('Financial webhook or billing ledger execution path touched.');
  }
  if (files.some((f) => f.isInfraOrIngress)) {
    baseScore += 22;
    riskFactors.push('Kubernetes / Envoy ingress traffic rate-limit policy updated.');
  }
  if (allEnvVars.length > 0) {
    baseScore += Math.min(14, allEnvVars.length * 5);
    riskFactors.push(`Requires ${allEnvVars.length} runtime environment variable(s): ${allEnvVars.join(', ')}.`);
  }
  if (totalAdditions + totalDeletions > 35) {
    baseScore += 8;
    riskFactors.push(`High line churn (${totalAdditions} additions, ${totalDeletions} deletions across ${files.length} files).`);
  }

  const overallRiskScore = Math.max(18, Math.min(98, baseScore));
  const overallSeverity = scoreToSeverity(overallRiskScore);

  // Cap visible DAG rows to max 3 per column so 880x390 canvas never overlaps
  const topFiles = files.slice(0, 3);
  const yCoords = computeTierYPositions(topFiles.length);

  const nodes: BlastNode[] = [];
  const edges: BlastEdge[] = [];

  topFiles.forEach((file, idx) => {
    const shortFile = file.filePath.split('/').pop() || file.filePath;
    const fileScore = Math.min(
      96,
      45 +
        (file.isSchemaMigration ? 30 : 0) +
        (file.isAuthOrCrypto ? 28 : 0) +
        (file.layer === 'payment' ? 25 : 0) +
        (file.isInfraOrIngress ? 22 : 0) +
        Math.min(12, file.additions + file.deletions)
    );

    const sourceId = `src-file-${idx}`;
    const y = yCoords[idx];

    nodes.push({
      id: sourceId,
      label: shortFile,
      sublabel: file.filePath,
      tier: 'changed_source',
      layer: file.layer,
      riskScore: fileScore,
      severity: scoreToSeverity(fileScore),
      x: TIER_X.changed_source,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      metricsBadge: `+${file.additions} / -${file.deletions} lines`,
    });

    const derived = deriveDependentsForLayer(file, idx);

    nodes.push({
      id: derived.dependent.id,
      label: derived.dependent.label,
      sublabel: derived.dependent.sublabel,
      tier: 'direct_dependent',
      layer: derived.dependent.layer,
      riskScore: derived.dependent.riskScore,
      severity: scoreToSeverity(derived.dependent.riskScore),
      x: TIER_X.direct_dependent,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      metricsBadge: derived.dependent.badge,
    });

    nodes.push({
      id: derived.downstream.id,
      label: derived.downstream.label,
      sublabel: derived.downstream.sublabel,
      tier: 'downstream_sla',
      layer: derived.downstream.layer,
      riskScore: derived.downstream.riskScore,
      severity: scoreToSeverity(derived.downstream.riskScore),
      x: TIER_X.downstream_sla,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      metricsBadge: derived.downstream.badge,
    });

    edges.push({
      id: `edge-${sourceId}-${derived.dependent.id}`,
      source: sourceId,
      target: derived.dependent.id,
      relationship: derived.edgeLabel1,
      criticalPath: fileScore >= 70 || derived.dependent.riskScore >= 75,
    });

    edges.push({
      id: `edge-${derived.dependent.id}-${derived.downstream.id}`,
      source: derived.dependent.id,
      target: derived.downstream.id,
      relationship: derived.edgeLabel2,
      criticalPath: derived.downstream.riskScore >= 75,
    });

    // Cross-tier coupling edge when multiple files interact (e.g. migration + service handler)
    if (idx > 0) {
      const prevDepId = nodes.find(
        (n) => n.tier === 'direct_dependent' && n.id.endsWith(`-${idx - 1}`)
      )?.id;
      if (prevDepId) {
        edges.push({
          id: `edge-cross-${sourceId}-${prevDepId}`,
          source: sourceId,
          target: prevDepId,
          relationship: 'Shared Transaction / Config',
          criticalPath: overallRiskScore >= 75,
        });
      }
    }
  });

  return {
    mrIid: params.mrIid,
    title: params.title,
    files,
    totalAdditions,
    totalDeletions,
    overallRiskScore,
    overallSeverity,
    riskFactors,
    extractedEnvVars: allEnvVars,
    extractedMigrations: allMigrations,
    nodes,
    edges,
    svgWidth: SVG_WIDTH,
    svgHeight: SVG_HEIGHT,
  };
}

export function verifyZeroNodeOverlap(analysis: BlastRadiusAnalysis): NodeOverlapVerification {
  const conflictPairs: Array<[string, string]> = [];
  let withinCanvasBounds = true;

  for (let i = 0; i < analysis.nodes.length; i++) {
    const a = analysis.nodes[i];
    if (
      a.x < 0 ||
      a.y < 0 ||
      a.x + a.width > analysis.svgWidth ||
      a.y + a.height > analysis.svgHeight
    ) {
      withinCanvasBounds = false;
    }

    for (let j = i + 1; j < analysis.nodes.length; j++) {
      const b = analysis.nodes[j];
      const overlapsX = a.x < b.x + b.width + 6 && a.x + a.width + 6 > b.x;
      const overlapsY = a.y < b.y + b.height + 6 && a.y + a.height + 6 > b.y;
      if (overlapsX && overlapsY) {
        conflictPairs.push([a.id, b.id]);
      }
    }
  }

  return {
    zeroOverlap: conflictPairs.length === 0 && withinCanvasBounds,
    conflictPairs,
    withinCanvasBounds,
  };
}

export function isolateBlastSubgraph(
  analysis: BlastRadiusAnalysis,
  selectedNodeId: string | null
): {
  activeNodeIds: Set<string>;
  activeEdgeIds: Set<string>;
} {
  if (!selectedNodeId || !analysis.nodes.some((n) => n.id === selectedNodeId)) {
    return {
      activeNodeIds: new Set(analysis.nodes.map((n) => n.id)),
      activeEdgeIds: new Set(analysis.edges.map((e) => e.id)),
    };
  }

  const activeNodeIds = new Set<string>([selectedNodeId]);
  const activeEdgeIds = new Set<string>();

  // Traverse forward (downstream)
  const forwardQueue = [selectedNodeId];
  while (forwardQueue.length > 0) {
    const current = forwardQueue.shift()!;
    for (const edge of analysis.edges) {
      if (edge.source === current) {
        activeEdgeIds.add(edge.id);
        if (!activeNodeIds.has(edge.target)) {
          activeNodeIds.add(edge.target);
          forwardQueue.push(edge.target);
        }
      }
    }
  }

  // Traverse backward (upstream)
  const backwardQueue = [selectedNodeId];
  while (backwardQueue.length > 0) {
    const current = backwardQueue.shift()!;
    for (const edge of analysis.edges) {
      if (edge.target === current) {
        activeEdgeIds.add(edge.id);
        if (!activeNodeIds.has(edge.source)) {
          activeNodeIds.add(edge.source);
          backwardQueue.push(edge.source);
        }
      }
    }
  }

  return { activeNodeIds, activeEdgeIds };
}
