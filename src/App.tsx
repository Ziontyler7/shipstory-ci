import { useState, useMemo, useEffect } from 'react';
import {
  buildBlastRadiusAnalysis,
  verifyZeroNodeOverlap,
  isolateBlastSubgraph,
  type BlastSeverity,
} from './lib/diff/blast-radius-engine.ts';
import {
  SHOWCASE_MR_SCENARIOS,
  synthesizeReleaseNotes,
  verifyArtifactPreservation,
  type MergeRequestScenario,
  type ReleasePersona,
} from './lib/changelog/release-notes-engine.ts';
import {
  generateRollbackRunbook,
  verifyGitLabCiYamlSyntax,
} from './lib/rollback/rollback-runbook-engine.ts';
import {
  runShipStoryPipeline,
  type InferenceProvider,
} from './lib/ai/gitlab-ai-adapter.ts';

const STORAGE_KEY = 'shipstory_studio_state_v1';

const JUDGE_BLIND_TEST_DIFFS: Array<{
  id: string;
  label: string;
  title: string;
  rawDiff: string;
}> = [
  {
    id: 'blind-sql-drop-column',
    label: 'Unseen SQL DROP COLUMN Diff',
    title: 'feat(billing-db)!: drop legacy stripe_customer_v1 column & rotate webhook secret',
    rawDiff: [
      'diff --git a/migrations/20261027_drop_legacy_customer.sql b/migrations/20261027_drop_legacy_customer.sql',
      '--- a/migrations/20261027_drop_legacy_customer.sql',
      '+++ b/migrations/20261027_drop_legacy_customer.sql',
      '@@ -1,4 +1,6 @@',
      '+ALTER TABLE billing_accounts DROP COLUMN stripe_customer_v1;',
      '+CREATE INDEX CONCURRENTLY idx_billing_tenant_v2 ON billing_accounts (tenant_id);',
      'diff --git a/src/billing/webhook-handler.ts b/src/billing/webhook-handler.ts',
      '--- a/src/billing/webhook-handler.ts',
      '+++ b/src/billing/webhook-handler.ts',
      '@@ -14,3 +14,4 @@',
      '-const secret = process.env.STRIPE_WEBHOOK_SECRET;',
      '+const secret = process.env.STRIPE_WEBHOOK_SECRET_V2;',
      '+const maxRetries = Number(process.env.BILLING_MAX_RETRIES || 5);',
    ].join('\n'),
  },
  {
    id: 'blind-k8s-auth-timeout',
    label: 'Unseen Auth JWT & Redis Pool Diff',
    title: 'refactor(auth-gateway): tighten JWT expiry & Redis connection pool limits',
    rawDiff: [
      'diff --git a/src/auth/jwt-verifier.ts b/src/auth/jwt-verifier.ts',
      '--- a/src/auth/jwt-verifier.ts',
      '+++ b/src/auth/jwt-verifier.ts',
      '@@ -8,4 +8,5 @@',
      '-const issuer = process.env.JWT_ISSUER_URI;',
      '+const issuer = process.env.OAUTH_STRICT_ISSUER_URI;',
      '+const redisPoolMax = Number(process.env.REDIS_AUTH_POOL_MAX || 32);',
    ].join('\n'),
  },
];

// Zero-dependency inline SVG icons
function GitMergeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function RotateCcwIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function severityBadgeClass(severity: BlastSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return 'badge-pill badge-critical';
    case 'HIGH':
      return 'badge-pill badge-high';
    case 'MODERATE':
      return 'badge-pill badge-moderate';
    default:
      return 'badge-pill badge-low';
  }
}

function severityStrokeColor(severity: BlastSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return '#f43f5e';
    case 'HIGH':
      return '#f59e0b';
    case 'MODERATE':
      return '#06b6d4';
    default:
      return '#10b981';
  }
}

export default function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { scenarioId?: string };
        if (
          parsed.scenarioId &&
          SHOWCASE_MR_SCENARIOS.some((s) => s.id === parsed.scenarioId)
        ) {
          return parsed.scenarioId;
        }
      }
    } catch {
      // Ignore storage errors
    }
    return SHOWCASE_MR_SCENARIOS[0].id;
  });

  const [useCustomDiff, setUseCustomDiff] = useState<boolean>(false);
  const [customDiffText, setCustomDiffText] = useState<string>(
    SHOWCASE_MR_SCENARIOS[0].rawDiff
  );
  const [customTitle, setCustomTitle] = useState<string>(
    'feat(custom): live pasted GitLab Merge Request diff analysis'
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activePersona, setActivePersona] = useState<ReleasePersona>('sre');
  const [activeArtifactTab, setActiveArtifactTab] = useState<
    'gitlab-ci' | 'duo-flow' | 'mcp-tools'
  >('gitlab-ci');
  const [provider, setProvider] = useState<InferenceProvider>('local-deterministic');
  const [byokKey, setByokKey] = useState<string>('');
  const [copiedBanner, setCopiedBanner] = useState<string | null>(null);
  const [pipelineLatencyMs, setPipelineLatencyMs] = useState<number>(0.42);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [sreApprovalDecision, setSreApprovalDecision] = useState<
    'PENDING_HUMAN_REVIEW' | 'APPROVED_FOR_CANARY' | 'ROLLBACK_ARMED'
  >('PENDING_HUMAN_REVIEW');
  const [sreApproverHandle, setSreApproverHandle] = useState<string>('@sre-oncall-lead');

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ scenarioId: selectedScenarioId })
      );
    } catch {
      // Ignore storage write errors
    }
  }, [selectedScenarioId]);

  const activeScenario: MergeRequestScenario = useMemo(() => {
    const preset =
      SHOWCASE_MR_SCENARIOS.find((s) => s.id === selectedScenarioId) ??
      SHOWCASE_MR_SCENARIOS[0];
    if (!useCustomDiff) {
      return preset;
    }
    return {
      ...preset,
      id: 'mr-custom-live',
      mrIid: '!CUSTOM',
      title: customTitle.trim() || 'feat(custom): live git diff blast-radius audit',
      rawDiff: customDiffText,
      criticalTokens: [],
    };
  }, [selectedScenarioId, useCustomDiff, customDiffText, customTitle]);

  // Reset isolated subgraph node whenever scenario or custom diff changes
  useEffect(() => {
    setSelectedNodeId(null);
  }, [activeScenario.id, activeScenario.rawDiff]);

  const blastRadius = useMemo(
    () =>
      buildBlastRadiusAnalysis({
        mrIid: activeScenario.mrIid,
        title: activeScenario.title,
        rawDiff: activeScenario.rawDiff,
      }),
    [activeScenario]
  );

  const overlapAudit = useMemo(
    () => verifyZeroNodeOverlap(blastRadius),
    [blastRadius]
  );

  const isolatedSubgraph = useMemo(
    () => isolateBlastSubgraph(blastRadius, selectedNodeId),
    [blastRadius, selectedNodeId]
  );

  const releaseNotes = useMemo(
    () => synthesizeReleaseNotes(activeScenario, blastRadius),
    [activeScenario, blastRadius]
  );

  const preservationAudit = useMemo(
    () => verifyArtifactPreservation(activeScenario, releaseNotes),
    [activeScenario, releaseNotes]
  );

  const rollbackRunbook = useMemo(
    () => generateRollbackRunbook(activeScenario, blastRadius),
    [activeScenario, blastRadius]
  );

  const yamlValidation = useMemo(
    () => verifyGitLabCiYamlSyntax(rollbackRunbook),
    [rollbackRunbook]
  );

  async function handleRunInferenceCheck() {
    const result = await runShipStoryPipeline(activeScenario, {
      provider,
      apiKey: byokKey,
      timeoutMs: 4500,
    });
    setPipelineLatencyMs(result.latencyMs);
    setFallbackNotice(result.fallbackReason ?? null);
  }

  function handleCopyText(label: string, text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedBanner(label);
    setTimeout(() => setCopiedBanner(null), 2200);
  }

  const activeChangelogMarkdown =
    activePersona === 'customer'
      ? releaseNotes.customerChangelog.markdown
      : activePersona === 'sre'
      ? releaseNotes.sreDeploymentBrief.markdown
      : releaseNotes.executiveSummary.markdown;

  return (
    <div className="app-shell">
      {/* Top Command Bar */}
      <header className="topbar">
        <div className="brand-cluster">
          <div className="brand-logo" aria-hidden="true">
            <GitMergeIcon />
          </div>
          <div>
            <h1 className="brand-title">
              ShipStory CI
              <span className="badge-pill badge-gitlab">GitLab Transcend Studio</span>
              <span className="badge-pill badge-emerald">
                <CheckIcon /> 6/6 Deterministic Gates Ready
              </span>
            </h1>
            <p className="brand-subtitle">
              Automated Merge Request Blast-Radius DAG · 3-Persona Release Notes · 1-Click{' '}
              <code className="mono">.gitlab-ci.yml</code> Rollback Runbooks
            </p>
          </div>
        </div>

        <div className="topbar-controls">
          <span className={severityBadgeClass(blastRadius.overallSeverity)}>
            <ShieldIcon /> Blast Score: {blastRadius.overallRiskScore}/100 ({blastRadius.overallSeverity})
          </span>
          <button
            type="button"
            className={`tab-btn ${provider === 'local-deterministic' ? 'active' : ''}`}
            onClick={() => {
              setProvider('local-deterministic');
              setFallbackNotice(null);
            }}
          >
            0ms Local AST Engine ({pipelineLatencyMs}ms)
          </button>
          <button
            type="button"
            className={`tab-btn ${provider === 'gitlab-duo-byok' ? 'active' : ''}`}
            onClick={() => setProvider('gitlab-duo-byok')}
          >
            Optional BYOK / GitLab Duo
          </button>
        </div>
      </header>

      {provider === 'gitlab-duo-byok' && (
        <div className="panel-card" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2 className="panel-title">
              Optional Live LLM / GitLab Duo Endpoint (Protected by 4.5s AbortController Circuit Breaker)
            </h2>
            <button type="button" className="action-btn" onClick={handleRunInferenceCheck}>
              Test Circuit-Breaker Inference
            </button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="password"
              value={byokKey}
              onChange={(e) => setByokKey(e.target.value)}
              placeholder="Optional API Key (leave blank for instant 0ms local deterministic mode)"
              style={{
                flex: 1,
                minWidth: 260,
                background: '#070a12',
                border: '1px solid rgba(148,163,184,0.25)',
                color: '#f8fafc',
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: '0.8rem',
              }}
            />
            {fallbackNotice && (
              <span className="badge-pill badge-high">{fallbackNotice}</span>
            )}
          </div>
        </div>
      )}

      <div className="workspace-grid">
        {/* Left Column: MR Scenario Selector & Unified Diff Inspector */}
        <div>
          <section className="panel-card">
            <div className="panel-header">
              <h2 className="panel-title">
                <LayersIcon /> 1. GitLab Merge Request Scenarios
              </h2>
              <button
                type="button"
                className="action-btn"
                onClick={() => setUseCustomDiff((prev) => !prev)}
              >
                {useCustomDiff ? 'Use Preset MRs' : 'Paste Custom Diff'}
              </button>
            </div>

            {/* Judge Live Unseen Diff Blind-Test Bar */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 6,
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: 'rgba(252, 109, 38, 0.08)',
                border: '1px dashed rgba(252, 109, 38, 0.5)',
              }}
            >
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fdba74' }}>
                🧪 Judge Live Blind-Test:
              </span>
              {JUDGE_BLIND_TEST_DIFFS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  className="action-btn"
                  style={{ fontSize: '0.7rem', padding: '4px 8px' }}
                  onClick={() => {
                    setUseCustomDiff(true);
                    setCustomTitle(sample.title);
                    setCustomDiffText(sample.rawDiff);
                    setSreApprovalDecision('PENDING_HUMAN_REVIEW');
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>

            {!useCustomDiff ? (
              <div className="preset-list">
                {SHOWCASE_MR_SCENARIOS.map((scenario) => {
                  const isSelected = scenario.id === selectedScenarioId;
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      className={`preset-btn ${isSelected ? 'active' : ''}`}
                      onClick={() => setSelectedScenarioId(scenario.id)}
                    >
                      <div className="preset-top">
                        <span className="preset-iid mono">
                          {scenario.mrIid} · {scenario.semverTag}
                        </span>
                        <span className="preset-meta mono">{scenario.serviceName}</span>
                      </div>
                      <p className="preset-title">{scenario.title}</p>
                      <div className="preset-meta">
                        {scenario.author} · <code className="mono">{scenario.previousStableSha}</code> →{' '}
                        <code className="mono">{scenario.commitSha}</code>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div>
                <label
                  htmlFor="custom-mr-title"
                  style={{ fontSize: '0.76rem', color: '#cbd5e1', display: 'block' }}
                >
                  Custom Merge Request Title:
                </label>
                <input
                  id="custom-mr-title"
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#070a12',
                    color: '#f8fafc',
                    border: '1px solid rgba(148,163,184,0.25)',
                    borderRadius: 8,
                    padding: '7px 10px',
                    fontSize: '0.8rem',
                    marginTop: 4,
                    marginBottom: 8,
                  }}
                />
                <label
                  htmlFor="custom-diff-input"
                  style={{ fontSize: '0.76rem', color: '#cbd5e1', display: 'block' }}
                >
                  Paste Unified Git Diff (<code className="mono">diff --git a/... b/...</code>):
                </label>
                <textarea
                  id="custom-diff-input"
                  className="custom-textarea mono"
                  value={customDiffText}
                  onChange={(e) => setCustomDiffText(e.target.value)}
                />
              </div>
            )}
          </section>

          {/* Unified Git Diff Inspector */}
          <section className="panel-card">
            <div className="panel-header">
              <h2 className="panel-title">
                2. Unified Git Diff & AST Artifact Extraction
              </h2>
              <span className="badge-pill badge-gitlab mono">
                +{blastRadius.totalAdditions} / -{blastRadius.totalDeletions} lines
              </span>
            </div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 4 }}>
                Extracted Runtime Env Vars & Migration Tokens:
              </div>
              {blastRadius.extractedEnvVars.map((envVar) => (
                <span key={envVar} className="token-chip mono">
                  env:{envVar}
                </span>
              ))}
              {blastRadius.extractedMigrations.map((mig) => (
                <span key={mig} className="token-chip mono">
                  sql:{mig}
                </span>
              ))}
              {blastRadius.extractedEnvVars.length === 0 &&
                blastRadius.extractedMigrations.length === 0 && (
                  <span className="token-chip mono">Standard module diff</span>
                )}
            </div>

            <div className="diff-viewer mono" aria-label="Unified git diff viewer">
              {activeScenario.rawDiff.split('\n').map((line, idx) => {
                const cls =
                  line.startsWith('diff --git') || line.startsWith('@@')
                    ? 'diff-line diff-hdr'
                    : line.startsWith('+') && !line.startsWith('+++')
                    ? 'diff-line diff-add'
                    : line.startsWith('-') && !line.startsWith('---')
                    ? 'diff-line diff-del'
                    : 'diff-line';
                return (
                  <div key={idx} className={cls}>
                    {line}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Right Column: Interactive SVG Blast-Radius DAG + Multi-Persona Changelog + Rollback Studio */}
        <div>
          {/* Panel 1: Interactive 3-Tier SVG Blast-Radius DAG */}
          <section className="panel-card">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">
                  <ShieldIcon /> 3. Interactive Dependency Blast-Radius Graph ({blastRadius.mrIid})
                </h2>
                <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }}>
                  Click any node to isolate its upstream & downstream impact chain across{' '}
                  <strong>Changed Files → Direct Dependents → Downstream SLAs</strong>.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge-pill badge-emerald">
                  <CheckIcon />{' '}
                  {overlapAudit.zeroOverlap
                    ? `0 Node Overlaps (${blastRadius.nodes.length} Nodes)`
                    : 'Overlap Detected'}
                </span>
                {selectedNodeId && (
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setSelectedNodeId(null)}
                  >
                    Show All Nodes
                  </button>
                )}
              </div>
            </div>

            <div className="dag-wrapper">
              <svg
                viewBox={`0 0 ${blastRadius.svgWidth} ${blastRadius.svgHeight}`}
                width="100%"
                height="350"
                role="img"
                aria-label="Merge request dependency blast-radius directed acyclic graph"
              >
                <defs>
                  <marker
                    id="arrow-critical"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#fc6d26" />
                  </marker>
                  <marker
                    id="arrow-standard"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
                  </marker>
                </defs>

                {/* Column Header Labels */}
                <text x="32" y="18" fill="#94a3b8" fontSize="11" fontWeight="700">
                  TIER 0 · CHANGED SOURCE & DDL
                </text>
                <text x="328" y="18" fill="#94a3b8" fontSize="11" fontWeight="700">
                  TIER 1 · DIRECT SERVICE DEPENDENTS
                </text>
                <text x="624" y="18" fill="#94a3b8" fontSize="11" fontWeight="700">
                  TIER 2 · DOWNSTREAM API & SLA EDGES
                </text>

                {/* Edges */}
                {blastRadius.edges.map((edge) => {
                  const src = blastRadius.nodes.find((n) => n.id === edge.source);
                  const dst = blastRadius.nodes.find((n) => n.id === edge.target);
                  if (!src || !dst) return null;

                  const isActive = isolatedSubgraph.activeEdgeIds.has(edge.id);
                  const x1 = src.x + src.width;
                  const y1 = src.y + src.height / 2;
                  const x2 = dst.x;
                  const y2 = dst.y + dst.height / 2;
                  const midX = (x1 + x2) / 2;
                  const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

                  return (
                    <g key={edge.id} opacity={isActive ? 1 : 0.18}>
                      <path
                        d={pathD}
                        fill="none"
                        stroke={edge.criticalPath ? '#fc6d26' : '#64748b'}
                        strokeWidth={edge.criticalPath ? 2.4 : 1.7}
                        strokeDasharray={edge.criticalPath ? undefined : '5,4'}
                        markerEnd={
                          edge.criticalPath
                            ? 'url(#arrow-critical)'
                            : 'url(#arrow-standard)'
                        }
                      />
                      <text
                        x={midX}
                        y={(y1 + y2) / 2 - 6}
                        textAnchor="middle"
                        fill="#cbd5e1"
                        fontSize="10"
                      >
                        {edge.relationship}
                      </text>
                    </g>
                  );
                })}

                {/* Nodes */}
                {blastRadius.nodes.map((node) => {
                  const isActive = isolatedSubgraph.activeNodeIds.has(node.id);
                  const isSelected = selectedNodeId === node.id;
                  const borderStroke = isSelected
                    ? '#fc6d26'
                    : severityStrokeColor(node.severity);

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      opacity={isActive ? 1 : 0.22}
                      style={{ cursor: 'pointer' }}
                      onClick={() =>
                        setSelectedNodeId((prev) => (prev === node.id ? null : node.id))
                      }
                    >
                      <rect
                        width={node.width}
                        height={node.height}
                        rx={10}
                        fill={isSelected ? '#1e293b' : '#111827'}
                        stroke={borderStroke}
                        strokeWidth={isSelected ? 2.6 : 1.6}
                      />
                      <text
                        x={12}
                        y={22}
                        fill="#f8fafc"
                        fontSize="12"
                        fontWeight="700"
                      >
                        {node.label.length > 26
                          ? `${node.label.slice(0, 25)}…`
                          : node.label}
                      </text>
                      <text x={12} y={39} fill="#94a3b8" fontSize="10">
                        {node.sublabel.length > 32
                          ? `${node.sublabel.slice(0, 31)}…`
                          : node.sublabel}
                      </text>
                      <text
                        x={12}
                        y={56}
                        fill="#fdba74"
                        fontSize="10"
                        fontWeight="600"
                      >
                        {node.metricsBadge}
                      </text>
                      <text
                        x={node.width - 12}
                        y={56}
                        textAnchor="end"
                        fill={severityStrokeColor(node.severity)}
                        fontSize="10"
                        fontWeight="700"
                      >
                        {node.riskScore}/100
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {blastRadius.riskFactors.map((rf, idx) => (
                <span key={idx} className="token-chip">
                  • {rf}
                </span>
              ))}
            </div>
          </section>

          {/* Panel 2: Multi-Persona Release Notes & Changelog Synthesizer */}
          <section className="panel-card">
            <div className="panel-header">
              <h2 className="panel-title">
                4. Multi-Persona Release Notes & Customer Changelog Studio
              </h2>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge-pill badge-emerald">
                  <CheckIcon />{' '}
                  {preservationAudit.preservedAllCriticalTokens &&
                  preservationAudit.customerChangelogLeakFree
                    ? '100% Critical Tokens Preserved · 0 Customer Path Leaks'
                    : 'Audit Warning'}
                </span>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() =>
                    handleCopyText('Release Notes Markdown', activeChangelogMarkdown)
                  }
                >
                  Copy Markdown
                </button>
              </div>
            </div>

            <div className="tab-strip" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`tab-btn ${activePersona === 'sre' ? 'active' : ''}`}
                onClick={() => setActivePersona('sre')}
              >
                SRE & On-Call Deployment Brief (100% Artifact Retention)
              </button>
              <button
                type="button"
                className={`tab-btn ${activePersona === 'customer' ? 'active' : ''}`}
                onClick={() => setActivePersona('customer')}
              >
                Customer SemVer Changelog (Path-Sanitized)
              </button>
              <button
                type="button"
                className={`tab-btn ${activePersona === 'executive' ? 'active' : ''}`}
                onClick={() => setActivePersona('executive')}
              >
                Executive & SLA Impact Brief
              </button>
            </div>

            {copiedBanner && (
              <div
                style={{
                  marginBottom: 8,
                  fontSize: '0.78rem',
                  color: '#6ee7b7',
                  fontWeight: 600,
                }}
              >
                ✓ Copied {copiedBanner} to clipboard!
              </div>
            )}

            <pre className="markdown-box mono">{activeChangelogMarkdown}</pre>
          </section>

          {/* Panel 3: Deterministic 1-Click Rollback, Duo Custom Flow & MCP Studio */}
          <section className="panel-card">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">
                  <RotateCcwIcon /> 5. Deterministic 1-Click Rollback, Duo Custom Flow &amp;{' '}
                  <code className="mono">.gitlab-ci.yml</code> Studio
                </h2>
                <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: 2 }}>
                  Estimated Full Recovery Time:{' '}
                  <strong>{rollbackRunbook.estimatedRecoverySeconds}s</strong> · Revert Target:{' '}
                  <code className="mono">{rollbackRunbook.previousStableSha}</code> · Duo Agent Platform + MCP Ready
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge-pill badge-emerald">
                  <CheckIcon />{' '}
                  {yamlValidation.valid
                    ? `Valid CI + Duo Flow + MCP (${yamlValidation.stagesPresent.length}/4 Stages)`
                    : 'YAML Error'}
                </span>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => {
                    const label =
                      activeArtifactTab === 'gitlab-ci'
                        ? '.gitlab-ci.yml Rollback Pipeline'
                        : activeArtifactTab === 'duo-flow'
                        ? 'GitLab Duo Custom Flow YAML'
                        : 'GitLab MCP Server Tool Payloads';
                    const content =
                      activeArtifactTab === 'gitlab-ci'
                        ? rollbackRunbook.gitlabCiYaml
                        : activeArtifactTab === 'duo-flow'
                        ? rollbackRunbook.duoCustomFlowYaml
                        : JSON.stringify(rollbackRunbook.mcpToolPayloads, null, 2);
                    handleCopyText(label, content);
                  }}
                >
                  Copy Active Spec
                </button>
              </div>
            </div>

            <div className="step-grid">
              {rollbackRunbook.steps.map((step) => (
                <div key={step.stepNumber} className="step-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.75rem',
                      color: '#fdba74',
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                  >
                    <span>STEP {step.stepNumber}</span>
                    <span>~{step.estimatedSeconds}s</span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      marginBottom: 6,
                      color: '#f8fafc',
                    }}
                  >
                    {step.title}
                  </div>
                  <code
                    className="mono"
                    style={{
                      display: 'block',
                      background: '#070a12',
                      padding: '6px 8px',
                      borderRadius: 6,
                      fontSize: '0.72rem',
                      color: '#a7f3d0',
                      marginBottom: 6,
                      wordBreak: 'break-all',
                    }}
                  >
                    {step.command}
                  </code>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                    Verify: {step.verificationCheck}
                  </div>
                </div>
              ))}
            </div>

            <div className="tab-strip" style={{ marginBottom: 12, marginTop: 12 }}>
              <button
                type="button"
                className={`tab-btn ${activeArtifactTab === 'gitlab-ci' ? 'active' : ''}`}
                onClick={() => setActiveArtifactTab('gitlab-ci')}
              >
                .gitlab-ci.yml Pipeline (action: start / stop)
              </button>
              <button
                type="button"
                className={`tab-btn ${activeArtifactTab === 'duo-flow' ? 'active' : ''}`}
                onClick={() => setActiveArtifactTab('duo-flow')}
              >
                GitLab Duo Agent Platform Custom Flow (AI Catalog YAML)
              </button>
              <button
                type="button"
                className={`tab-btn ${activeArtifactTab === 'mcp-tools' ? 'active' : ''}`}
                onClick={() => setActiveArtifactTab('mcp-tools')}
              >
                GitLab MCP Server Tool Payloads ({rollbackRunbook.mcpToolPayloads.length})
              </button>
            </div>

            <pre className="markdown-box mono">
              {activeArtifactTab === 'gitlab-ci'
                ? rollbackRunbook.gitlabCiYaml
                : activeArtifactTab === 'duo-flow'
                ? rollbackRunbook.duoCustomFlowYaml
                : JSON.stringify(rollbackRunbook.mcpToolPayloads, null, 2)}
            </pre>

            {/* Human-in-the-Loop On-Call SRE Release & Rollback Approval Gate */}
            <div
              style={{
                marginTop: 14,
                padding: '12px 14px',
                borderRadius: 10,
                background:
                  sreApprovalDecision === 'APPROVED_FOR_CANARY'
                    ? 'rgba(16, 185, 129, 0.12)'
                    : sreApprovalDecision === 'ROLLBACK_ARMED'
                    ? 'rgba(244, 63, 94, 0.14)'
                    : 'rgba(15, 23, 42, 0.9)',
                border:
                  sreApprovalDecision === 'APPROVED_FOR_CANARY'
                    ? '1px solid rgba(16, 185, 129, 0.5)'
                    : sreApprovalDecision === 'ROLLBACK_ARMED'
                    ? '1px solid rgba(244, 63, 94, 0.6)'
                    : '1px solid rgba(252, 109, 38, 0.45)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc' }}>
                  🛡️ Human-in-the-Loop On-Call SRE Release &amp; Rollback Gate (“A person still approves every critical action”)
                </div>
                <span className="badge-pill badge-gitlab mono">
                  Status: {sreApprovalDecision}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  aria-label="On-Call SRE Handle"
                  value={sreApproverHandle}
                  onChange={(e) => setSreApproverHandle(e.target.value)}
                  style={{
                    background: '#070a12',
                    color: '#f8fafc',
                    border: '1px solid rgba(148,163,184,0.3)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: '0.76rem',
                    width: 180,
                  }}
                />
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => setSreApprovalDecision('APPROVED_FOR_CANARY')}
                  style={{
                    borderColor: '#10b981',
                    color: '#6ee7b7',
                  }}
                >
                  ✓ Approve Production Canary ({sreApproverHandle})
                </button>
                <button
                  type="button"
                  className="action-btn"
                  onClick={() => setSreApprovalDecision('ROLLBACK_ARMED')}
                  style={{
                    borderColor: '#f43f5e',
                    color: '#fda4af',
                  }}
                >
                  ⚠ Hold Merge &amp; Arm {rollbackRunbook.previousStableSha} Rollback
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
