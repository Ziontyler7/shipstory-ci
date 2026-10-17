import {
  buildBlastRadiusAnalysis,
  type BlastRadiusAnalysis,
} from '../diff/blast-radius-engine.ts';
import {
  synthesizeReleaseNotes,
  type MergeRequestScenario,
  type MultiPersonaReleaseNotes,
} from '../changelog/release-notes-engine.ts';
import {
  generateRollbackRunbook,
  type RollbackRunbook,
} from '../rollback/rollback-runbook-engine.ts';

export type InferenceProvider = 'local-deterministic' | 'gitlab-duo-byok';

export interface AIAdapterConfig {
  provider: InferenceProvider;
  apiKey?: string;
  endpointUrl?: string;
  timeoutMs?: number;
}

export interface ShipStoryCompleteBundle {
  providerUsed: InferenceProvider;
  fallbackUsed: boolean;
  latencyMs: number;
  fallbackReason?: string;
  blastRadius: BlastRadiusAnalysis;
  releaseNotes: MultiPersonaReleaseNotes;
  rollbackRunbook: RollbackRunbook;
}

export const DEFAULT_TIMEOUT_MS = 4500;

export async function runShipStoryPipeline(
  mr: MergeRequestScenario,
  config: AIAdapterConfig = { provider: 'local-deterministic' }
): Promise<ShipStoryCompleteBundle> {
  const startTime = performance.now();

  const blastRadius = buildBlastRadiusAnalysis({
    mrIid: mr.mrIid,
    title: mr.title,
    rawDiff: mr.rawDiff,
  });
  const releaseNotes = synthesizeReleaseNotes(mr, blastRadius);
  const rollbackRunbook = generateRollbackRunbook(mr, blastRadius);

  if (config.provider === 'local-deterministic' || !config.apiKey?.trim()) {
    const latencyMs = Math.max(0.1, Number((performance.now() - startTime).toFixed(2)));
    return {
      providerUsed: 'local-deterministic',
      fallbackUsed: false,
      latencyMs,
      blastRadius,
      releaseNotes,
      rollbackRunbook,
    };
  }

  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint =
    config.endpointUrl?.trim() || 'https://api.openai.com/v1/chat/completions';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are ShipStory CI, a GitLab DevSecOps release executive summary synthesizer. Return a 1-sentence executive impact refinement.',
          },
          {
            role: 'user',
            content: `MR ${mr.mrIid}: ${mr.title}\nSummary: ${mr.summary}`,
          },
        ],
        max_tokens: 120,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const enhancedOutcome = data.choices?.[0]?.message?.content?.trim();

    if (enhancedOutcome) {
      releaseNotes.executiveSummary.businessOutcome = enhancedOutcome;
    }

    const latencyMs = Math.max(0.1, Number((performance.now() - startTime).toFixed(2)));
    return {
      providerUsed: 'gitlab-duo-byok',
      fallbackUsed: false,
      latencyMs,
      blastRadius,
      releaseNotes,
      rollbackRunbook,
    };
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error ? err.message : 'External inference endpoint unreachable';
    const latencyMs = Math.max(0.1, Number((performance.now() - startTime).toFixed(2)));
    return {
      providerUsed: 'local-deterministic',
      fallbackUsed: true,
      fallbackReason: `Circuit breaker fallback (${timeoutMs}ms guard): ${reason}`,
      latencyMs,
      blastRadius,
      releaseNotes,
      rollbackRunbook,
    };
  }
}
