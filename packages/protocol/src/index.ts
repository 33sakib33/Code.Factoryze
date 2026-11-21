import { z } from 'zod';
export * from './browser-checks.ts';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const profileVersion = z.string().regex(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/);
export const temperatureSchema = z.number().min(0).max(2);

// Draft v1 contracts. A shipped schema number must never be repurposed.
export const taskPackSchema = z.strictObject({
  schema: z.literal(1),
  id: identifier,
  title: z.string().min(1),
  brief: z.string().min(1),
  minimumPython: z.string().regex(/^3\.\d+$/),
  recommendedKnowledge: z.array(z.string().refine(value => value === value.trim() && [...value].length >= 2 && [...value].length <= 100 && !value.includes('\0'))).min(1).max(5)
    .refine(values => new Set(values.map(value => value.toLowerCase())).size === values.length).optional(),
  topics: z.array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).min(2).max(40)).min(1).max(5)
    .refine(values => new Set(values).size === values.length).optional(),
  timeHintMinutes: z.number().int().positive().optional(),
  budgetTokens: z.number().int().positive().optional(),
  retired: z.boolean().optional(),
  // Relative to workspace/: a root-level file (invoices.py) or a nested path (app/main.py); never hidden, absolute or outside.
  entryFile: z.string().regex(/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:\/[a-zA-Z0-9_.-]+)*$/).refine(path => !path.split('/').includes('..')).optional()
});
export type TaskPack = z.infer<typeof taskPackSchema>;
export const publicTestResultSchema = z.strictObject({
  passed: z.number().int().nonnegative(), total: z.number().int().positive(),
  failures: z.array(z.strictObject({ name: z.string(), message: z.string() }))
}).refine(result => result.passed <= result.total);
export type PublicTestResult = z.infer<typeof publicTestResultSchema>;
export const benchmarkPromptsSchema = z.strictObject({
  schema: z.literal(1), taskId: identifier,
  expert: z.array(z.string().trim().min(1)).min(1),
  naive: z.array(z.string().trim().min(1)).min(1),
  /** Optional partial-diagnosis script, between expert and naive. Used by variance runs, not baselines. */
  middle: z.array(z.string().trim().min(1)).min(1).optional()
});
export type BenchmarkPrompts = z.infer<typeof benchmarkPromptsSchema>;

export const labConfigSchema = z.strictObject({
  schema: z.literal(1),
  lab: identifier,
  task: z.string().min(1),
  timeLimitMinutes: z.number().int().positive(),
  agent: z.strictObject({
    profile: profileVersion,
    model: z.string().min(1),
    permissions: z.strictObject({ edit: z.enum(['ask', 'allow', 'deny']), shell: z.enum(['ask', 'allow', 'deny']) })
  }),
  budget: z.strictObject({
    limit: z.number().int().positive(),
    weights: z.strictObject({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative(),
      cacheWrite: z.number().nonnegative()
    })
  })
});
export type LabConfig = z.infer<typeof labConfigSchema>;

// Unknown types remain readable so older clients can skip newer events.
export const eventSchema = z.strictObject({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  type: z.string().regex(/^[a-z][a-z0-9_]*@\d+$/),
  at: z.iso.datetime(),
  data: z.record(z.string(), z.unknown())
});
export type FactoryzeEvent = z.infer<typeof eventSchema>;

// Input includes cache reads/writes; adapters normalize provider-specific semantics.
export const tokenUsageSchema = z.strictObject({
  input: z.number().int().nonnegative(), output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(), cacheWrite: z.number().int().nonnegative()
}).refine(usage => usage.cacheRead + usage.cacheWrite <= usage.input, 'Cache tokens exceed input');
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
const benchmarkRunSchema = z.strictObject({
  correctness: z.strictObject({ passed: z.number().int().nonnegative(), total: z.number().int().positive() })
    .refine(value => value.passed <= value.total),
  raw: tokenUsageSchema, weightedTokens: z.number().nonnegative(),
  requests: z.number().int().positive(), turns: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative()
});
export const benchmarkBaselineSchema = z.strictObject({
  schema: z.literal(1), taskId: identifier, profile: profileVersion, model: z.string().min(1),
  promptsHash: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.iso.datetime(),
  expert: benchmarkRunSchema, naive: benchmarkRunSchema
});
export type BenchmarkBaseline = z.infer<typeof benchmarkBaselineSchema>;
export const usageScopeSchema = z.strictObject({
  userId: z.string().min(1), taskId: identifier, profile: profileVersion, model: z.string().min(1)
});
export type UsageScope = z.infer<typeof usageScopeSchema>;
export const usageTotalsSchema = z.strictObject({
  scope: usageScopeSchema, raw: tokenUsageSchema, weighted: z.number().nonnegative(),
  workspace: z.string().min(1).optional(),
  budgetLimit: z.number().positive(), remaining: z.number().nonnegative(),
  requests: z.number().int().nonnegative(), incompleteRequests: z.number().int().nonnegative(),
  status: z.enum(['ready', 'exhausted', 'incomplete'])
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;

export const practiceWorkspaceSchema = z.strictObject({ workspace: z.string().min(1), task: taskPackSchema,
  lab: z.strictObject({ id: identifier, studentId: z.string().min(1), state: z.enum(['open', 'closed']), closesAt: z.iso.datetime(), model: z.string().min(1) }).optional(),
  budgetTokens: z.number().int().positive().optional(), usage: z.array(usageTotalsSchema).optional(), budgetOverride: z.number().int().positive().nullable().optional() });
export type PracticeWorkspace = z.infer<typeof practiceWorkspaceSchema>;
export const workspaceUsageSchema = z.strictObject({
  scope: usageScopeSchema, raw: tokenUsageSchema, weighted: z.number().nonnegative(),
  requests: z.number().int().nonnegative(), incompleteRequests: z.number().int().nonnegative(),
  promptTurns: z.number().int().nonnegative().optional(),
  promptTurnsComplete: z.boolean().optional()
});
export type WorkspaceUsage = z.infer<typeof workspaceUsageSchema>;
export const baselineComparisonSchema = z.strictObject({
  profile: profileVersion, model: z.string().min(1), baselinePromptsHash: z.string().regex(/^[a-f0-9]{64}$/),
  weightedTokensRatio: z.number().nonnegative(), promptTurnsRatio: z.number().nonnegative()
});
export type BaselineComparison = z.infer<typeof baselineComparisonSchema>;
export const judgeVerdictSchema = z.strictObject({
  category: z.enum(['specific', 'vague', 'delegation', 'clone', 'off_task']),
  specificity: z.number().min(0).max(100), reason: z.string().min(1).max(1000)
});
export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;
export const promptAssessmentSchema = z.strictObject({
  promptId: z.string().min(1), model: z.string(), status: z.enum(['off', 'scored', 'unavailable']),
  verdict: judgeVerdictSchema.optional(), acceptedEdit: z.boolean()
});
export type PromptAssessment = z.infer<typeof promptAssessmentSchema>;
export const scoringV1Schema = z.strictObject({
  scoring_version: z.literal(1), correctness: z.number().min(0).max(100),
  efficiency: z.number().min(0).max(100).nullable(), specificity: z.number().min(0).max(100).nullable(),
  total: z.number().min(0).max(100).nullable(), unavailable: z.array(z.string())
});
export type ScoringV1 = z.infer<typeof scoringV1Schema>;
export const scoringContextSchema = z.strictObject({ baselineEligible: z.boolean(), promptHistoryComplete: z.boolean() });
export type ScoringContext = z.infer<typeof scoringContextSchema>;
export const usageIssueSchema = z.strictObject({
  requestId: z.string(), scope: usageScopeSchema, workspace: z.string().nullable(),
  status: z.enum(['pending', 'incomplete']), observed: tokenUsageSchema.nullable()
});
export type UsageIssue = z.infer<typeof usageIssueSchema>;
export const reconciliationSchema = z.strictObject({
  requestId: z.string().min(1), usage: tokenUsageSchema, reference: z.string().trim().min(3).max(200),
  confirmed: z.literal(true), confirmAbandoned: z.boolean().optional()
});
export type Reconciliation = z.infer<typeof reconciliationSchema>;
export const hiddenCheckSchema = z.strictObject({ name: z.string().min(1).max(200), passed: z.boolean(), message: z.string().max(2000).optional() });
export type HiddenCheck = z.infer<typeof hiddenCheckSchema>;
/** A recorded session configuration. Provider defaults remain unknown, never guessed. */
export const executionPinSchema = z.strictObject({
  profile: profileVersion, model: z.string().min(1),
  funding: z.enum(['byok', 'trial']).optional(),
  providerHost: z.string().min(1).max(300).refine(host => {
    if (!URL.canParse(`https://${host}`)) return false;
    const url = new URL(`https://${host}`);
    return url.host === host && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  }, 'Expected a provider host without credentials or a path'),
  temperature: temperatureSchema.nullable(), os: z.enum(['darwin', 'linux', 'win32'])
});
export type ExecutionPin = z.infer<typeof executionPinSchema>;
export const promptUsageSchema = z.strictObject({
  promptId: z.string().min(1), index: z.number().int().positive(), weighted: z.number().nonnegative(),
  state: z.enum(['running', 'complete', 'stopped', 'failed']), incomplete: z.boolean().optional()
});
export type PromptUsage = z.infer<typeof promptUsageSchema>;
export const reportActivityKinds = ['prompt', 'exploration', 'editing', 'commands', 'mixed', 'unattributed'] as const;
const count = z.number().int().nonnegative();
/** Submission-time observations. Attribution groups model requests, never separately metered tool/context costs. */
export const reportInsightsSchema = z.strictObject({
  schema: z.literal(1), coverage: z.enum(['recorded', 'partial', 'unavailable']),
  prompts: z.array(promptUsageSchema),
  tools: z.strictObject({ exploration: count, editing: count, commands: count, failed: count, unfinished: count })
    .refine(value => value.failed + value.unfinished <= value.exploration + value.editing + value.commands),
  approvals: z.strictObject({ approved: count, declined: count, cancelled: count }),
  attribution: z.array(z.strictObject({ kind: z.enum(reportActivityKinds), requests: count, weighted: z.number().nonnegative() }))
    .length(reportActivityKinds.length).refine(values => new Set(values.map(value => value.kind)).size === reportActivityKinds.length),
  incompleteRequests: count
}).refine(value => value.incompleteRequests <= value.attribution.reduce((sum, bucket) => sum + bucket.requests, 0));
export type ReportInsights = z.infer<typeof reportInsightsSchema>;
export const practiceReportSchema = z.strictObject({
  schema: z.literal(1), kind: z.literal('practice'), taskId: identifier,
  submittedAt: z.iso.datetime(),
  lab: z.strictObject({ id: identifier, studentId: z.string().min(1), submissionId: z.string().min(1), snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
    revision: z.number().int().nonnegative(), releasedAt: z.iso.datetime() }).optional(),
  correctness: z.strictObject({ passed: z.number().int().nonnegative(), total: z.number().int().positive() }),
  usage: z.array(usageTotalsSchema), workspaceUsage: z.array(workspaceUsageSchema).optional(),
  /** Distinct recorded session configurations, in first-use order. Absent on older reports. */
  executionPins: z.array(executionPinSchema).optional(),
  /** Immutable activity and prompt-cost snapshot. Absent on older submissions; never backfilled from live activity. */
  insights: reportInsightsSchema.optional(),
  baselineComparisons: z.array(baselineComparisonSchema).optional(),
  baselineWarning: z.literal('invalid-or-stale').optional(),
  promptAssessments: z.array(promptAssessmentSchema).optional(), scoring: scoringV1Schema.optional(), scoringContext: scoringContextSchema.optional(),
  /** Per-check results. Solo practice packs are public, so names and short failure messages are shown to the student. */
  checks: z.array(hiddenCheckSchema).optional(),
  /** Present when the attempt's limit changed after the agent started, for example a raised practice budget. */
  budget: z.strictObject({ limit: z.number().positive(), initialLimit: z.number().positive() }).optional()
}).refine(report => report.correctness.passed <= report.correctness.total, 'Passed tests exceed total tests');
export type PracticeReport = z.infer<typeof practiceReportSchema>;
/** Deliberately small public projection of a local result; the hosted service does not grade it. */
export const desktopResultShareInputSchema = z.strictObject({
  reportKey: z.string().regex(/^[a-f0-9]{64}$/), taskId: identifier.max(100), title: z.string().trim().min(1).max(120),
  submittedAt: z.iso.datetime(), passed: z.number().int().min(0).max(100), total: z.number().int().min(1).max(100),
  weightedTokens: z.number().int().min(0).max(1_000_000_000).optional(),
  budgetTokens: z.number().int().min(1).max(1_000_000_000).optional(),
  score: z.number().int().min(0).max(100).optional()
}).refine(value => value.passed <= value.total && (value.weightedTokens === undefined) === (value.budgetTokens === undefined));
export type DesktopResultShareInput = z.infer<typeof desktopResultShareInputSchema>;
export const desktopResultShareStateSchema = z.union([
  z.strictObject({ published: z.literal(false) }),
  z.strictObject({ published: z.literal(true), url: z.url(), expiresAt: z.iso.datetime() })
]);
export type DesktopResultShareState = z.infer<typeof desktopResultShareStateSchema>;
/** Draft: one self-reported result for a hosted task attempt (POST /api/desktop/results). The client never sends a rank, score or "solved". */
const resultCount = z.number().int().min(0).max(1_000_000_000);
export const desktopResultModelSchema = z.string().regex(/^[A-Za-z0-9._:/-]{1,120}$/);
export const desktopResultInputSchema = z.strictObject({
  attemptId: z.uuid(), taskId: identifier.max(100), packSha256: z.string().regex(/^[a-f0-9]{64}$/),
  funding: z.enum(['hosted', 'own_key']), model: desktopResultModelSchema,
  budgetTokens: resultCount.min(1), weightedTokens: resultCount,
  usage: z.strictObject({ inputTokens: resultCount, cachedInputTokens: resultCount, outputTokens: resultCount }),
  passed: z.number().int().min(0).max(10_000), total: z.number().int().min(1).max(10_000),
  submittedAt: z.iso.datetime(),
  solution: z.strictObject({ files: z.array(z.strictObject({ path: z.string().min(1).max(500), content: z.string().max(65_536) })).min(1).max(32) }).optional()
}).refine(value => value.passed <= value.total && value.usage.cachedInputTokens <= value.usage.inputTokens);
export type DesktopResultInput = z.infer<typeof desktopResultInputSchema>;
// Responses tolerate additional server fields so an additive backend change does not break released clients.
export const desktopResultResponseSchema = z.object({
  recorded: z.literal(true), counted: z.boolean(), solved: z.boolean(), tokenCheck: z.enum(['checked', 'self_reported']),
  standing: z.object({ board: z.enum(['hosted', 'own_key']), rank: z.number().int().positive(), solved: z.number().int().nonnegative() }).nullable()
});
export type DesktopResultResponse = z.infer<typeof desktopResultResponseSchema>;
/** What the attempt report shows about a hosted result. Local facts stay visible whether or not anything was sent. */
export const hostedResultViewSchema = z.strictObject({
  taskId: identifier, testFiles: z.enum(['unchanged', 'edited']),
  model: z.string().max(200).optional(), funding: z.enum(['hosted', 'own_key']).optional(),
  weightedTokens: z.number().nonnegative().optional(), budgetTokens: z.number().int().positive(),
  passed: z.number().int().nonnegative(), total: z.number().int().positive(),
  sync: z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('sent'), response: desktopResultResponseSchema, leaderboardURL: z.url(), solutionIncluded: z.boolean(), solutionNote: z.string().max(300).optional() }),
    z.strictObject({ status: z.literal('not_counted_edited') }),
    z.strictObject({ status: z.literal('already_sent'), submission: z.number().int().positive() }),
    z.strictObject({ status: z.literal('signed_out') }),
    z.strictObject({ status: z.literal('not_eligible'), message: z.string().min(1).max(300) }),
    z.strictObject({ status: z.literal('unavailable'), retry: z.boolean() }),
    z.strictObject({ status: z.literal('rejected'), code: z.string().max(80), message: z.string().min(1).max(300) })
  ])
});
export type HostedResultView = z.infer<typeof hostedResultViewSchema>;
/** Home lists attempts and results from these summaries. They hold counts only: no prompt text, paths outside the workspace, or keys. */
export const attemptSummarySchema = z.strictObject({
  workspace: z.string().min(1), taskId: identifier, title: z.string().min(1), attempt: z.number().int().positive(),
  startedAt: z.iso.datetime(), lastActivityAt: z.iso.datetime(),
  weighted: z.number().nonnegative(), budgetLimit: z.number().positive(),
  status: z.enum(['ready', 'exhausted', 'incomplete']), submissions: z.number().int().nonnegative(),
  latest: z.strictObject({ passed: z.number().int().nonnegative(), total: z.number().int().positive(), submittedAt: z.iso.datetime() }).optional(),
  /** Set only for lab attempts, so Practice tasks can leave them out. */
  lab: identifier.optional()
});
export type AttemptSummary = z.infer<typeof attemptSummarySchema>;
export const reportSummarySchema = z.strictObject({
  workspace: z.string().min(1), taskId: identifier, title: z.string().min(1), attempt: z.number().int().positive(),
  submission: z.number().int().positive(), submissions: z.number().int().positive(), submittedAt: z.iso.datetime(),
  passed: z.number().int().nonnegative(), total: z.number().int().positive(), weighted: z.number().nonnegative(),
  score: z.number().nullable()
});
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export const pythonCheckSchema = z.strictObject({ ok: z.boolean(), version: z.string().optional(), minimum: z.string(), message: z.string().max(1000).optional() });
export type PythonCheck = z.infer<typeof pythonCheckSchema>;
export const trialModelSchema = z.strictObject({ id: z.string().min(1).max(120), maxInputTokens: z.number().int().min(8192).max(131072),
  maxOutputTokens: z.number().int().min(1).max(8192), outputParameter: z.enum(['max_tokens', 'max_completion_tokens']) });
export type TrialModel = z.infer<typeof trialModelSchema>;
export const trialRequestLimitsSchema = z.strictObject({ maxRequestBytes: z.number().int().positive().max(65536),
  maxMessages: z.number().int().positive().max(128), maxTools: z.number().int().positive().max(32), maxInputTokens: z.number().int().positive() });
export type TrialRequestLimits = z.infer<typeof trialRequestLimitsSchema>;
export const trialAccountSchema = z.strictObject({ id: z.string(), email: z.string(), claimed: z.boolean(), suspended: z.boolean(),
  grantedMicro: z.number().int().nonnegative(), spentMicro: z.number().int().nonnegative(), reservedMicro: z.number().int().nonnegative(),
  availableMicro: z.number().int().nonnegative(), expiresAt: z.string(),
  dailyLimitMicro: z.number().int().nonnegative().optional(), dailySpentMicro: z.number().int().nonnegative().optional(),
  dailyReservedMicro: z.number().int().nonnegative().optional(), dailyAvailableMicro: z.number().int().nonnegative().optional(), dailyResetAt: z.string().optional() });
export const trialAccountViewSchema = z.strictObject({ origin: z.url(), selected: z.boolean(), signedIn: z.boolean(),
  sessionExpiresAt: z.string().optional(), account: trialAccountSchema.optional(), models: z.array(trialModelSchema), selectedModel: z.string().optional(),
  programEnabled: z.boolean(), inferenceEnabled: z.boolean(), maxRequestBytes: z.number().int(), maxMessages: z.number().int(), maxTools: z.number().int() });
export type TrialAccountView = z.infer<typeof trialAccountViewSchema>;
export const gatewayConnectionSchema = z.strictObject({
  baseURL: z.url(), sessionToken: z.string().min(1), model: z.string().min(1),
  api: z.enum(['openai-chat', 'anthropic-messages']),
  contextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
  temperature: temperatureSchema.optional(),
  trialLimits: trialRequestLimitsSchema.optional(),
  opencodePublic: z.boolean().optional(),
  packageIndexURL: z.url().optional(), pipConfigFile: z.string().optional()
});
export type GatewayConnection = z.infer<typeof gatewayConnectionSchema>;

export const gatewayErrorMessages = {
  trial_program_unavailable: 'Factoryze’s sponsored allowance is currently unavailable. Your account balance is separate; try again later or explicitly use your own API key.',
  trial_model_unavailable: 'This trial model is no longer available. Choose another model in Model connection.',
  trial_service_unavailable: 'The Factoryze trial service is unavailable. Your work is saved; try again later.',
  trial_sign_in_required: 'Your trial sign-in has expired or was revoked. Sign in again in Model connection.',
  trial_credit_exhausted: 'Your trial credits are insufficient for this request. Review your balance in Model connection or explicitly switch to your own API key.',
  trial_daily_limit_exhausted: 'Your sponsored practice limit for today has been reached. Your work is saved; try again after 00:00 UTC or use your own API key.',
  trial_unavailable: 'Your trial is expired, suspended or not enrolled. Review your trial account in Model connection.',
  trial_paused: 'Factoryze trial requests are paused. Your work is saved; try again later or explicitly choose your own API key.',
  trial_request_limit: 'This request exceeds the trial model limits. Start a new agent session or use a shorter prompt or smaller files.',
  trial_rate_limited: 'The trial service is busy or has reached its request limit. Wait before trying again.',
  trial_request_conflict: 'This trial request was already admitted. It will not be sent again; review your balance before continuing.',
  budget_exhausted: 'The task token budget is exhausted. Stop the agent and increase the task budget in Configuration to continue; tokens already used are retained.',
  accounting_incomplete: 'Token accounting is incomplete. Reconcile usage before sending another prompt.',
  provider_model_not_found: 'The provider could not find this model or endpoint. Check the model ID and base URL in Configuration, or refresh and select an available OpenCode model.',
  provider_data_policy: 'OpenRouter could not route this model under your account data policy. Review OpenRouter Settings → Privacy and provider restrictions, or choose a model allowed by your current settings.',
  provider_no_route: 'OpenRouter has no eligible provider endpoint for this model. Check provider availability, account routing and key restrictions, or select another model. A valid model ID can still have no available route.',
  provider_payment_required: 'The model provider requires credit or billing access. Check your provider account or select an available free model.',
  provider_authentication: 'The provider rejected its API key. Update the key in Configuration or reconnect and reimport the OpenCode model.',
  provider_forbidden: 'The provider denied access to this model. Check your provider account and model access, or select another model.',
  provider_rate_limited: 'The provider rate limit was reached. Wait and retry, or select another available model.',
  provider_unavailable: 'The model provider is unavailable. Wait and retry.',
  provider_temperature_unsupported: 'This model rejected the temperature setting. Open Settings, change the model connection and leave Temperature blank to use the provider default, or enter a value supported by the model.',
  provider_rejected: 'The model provider rejected the request. Check the provider API, model ID and base URL in Configuration.'
} as const;
export const gatewayErrorSchema = z.strictObject({ error: z.strictObject({
  type: z.literal('factoryze_gateway_error'), message: z.string(),
  code: z.enum(Object.keys(gatewayErrorMessages) as [keyof typeof gatewayErrorMessages, ...(keyof typeof gatewayErrorMessages)[]]).optional()
}) });
export type GatewayErrorCode = keyof typeof gatewayErrorMessages;

export function isOpenCodePublicEndpoint(baseURL: string): boolean {
  return ['https://opencode.ai/inference/openai/v1', 'https://opencode.ai/zen/v1'].includes(baseURL.replace(/\/$/, ''));
}

/** OpenRouter's supported gateway transport is Chat Completions, including legacy settings. */
export function providerApi(baseURL: string, api: GatewayConnection['api']): GatewayConnection['api'] {
  return URL.canParse(baseURL) && new URL(baseURL).origin === 'https://openrouter.ai' ? 'openai-chat' : api;
}

/** Accept the documented OpenRouter request URL as well as its API prefix. Preserve unsafe components for validation. */
export function providerBaseURL(baseURL: string): string {
  if (!URL.canParse(baseURL)) return baseURL;
  const url = new URL(baseURL);
  if (url.origin === 'https://openrouter.ai' && /^\/api\/v1(?:\/chat\/completions)?\/?$/.test(url.pathname)) {
    url.pathname = '/api/v1';
    return url.href;
  }
  return baseURL;
}

export const modelSettingsSchema = z.strictObject({
  schema: z.literal(1),
  agent: z.enum(['opencode', 'factoryze']).optional(),
  api: z.enum(['openai-chat', 'anthropic-messages']),
  baseURL: z.url(), model: z.string().trim().min(1),
  contextWindow: z.number().int().positive(), maxOutputTokens: z.number().int().positive(),
  temperature: temperatureSchema.optional(),
  budgetTokens: z.number().int().positive().optional(),
  openCodeModel: z.string().trim().min(1).optional(),
  authentication: z.enum(['api-key', 'opencode-public', 'trial']).optional(),
  modules: z.strictObject({ judge: z.boolean(), scoring: z.boolean() }).optional(),
  judgeModel: z.string().trim().min(1).optional()
}).superRefine((settings, context) => {
  // z.url reports malformed input; do not throw from a refinement during discovery/safeParse.
  if (!URL.canParse(settings.baseURL)) return;
  const url = new URL(settings.baseURL);
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    context.addIssue({ code: 'custom', message: 'Provider URL must use HTTPS (HTTP is allowed only on loopback)', path: ['baseURL'] });
  }
  if (settings.maxOutputTokens > settings.contextWindow) {
    context.addIssue({ code: 'custom', message: 'Maximum output tokens cannot exceed the context window', path: ['maxOutputTokens'] });
  }
  if (settings.authentication === 'opencode-public' && (!isOpenCodePublicEndpoint(settings.baseURL) || settings.api !== 'openai-chat' ||
    settings.openCodeModel !== `opencode/${settings.model}` || !(/-free$/.test(settings.model) || settings.model === 'big-pickle') || settings.modules?.judge)) {
    context.addIssue({ code: 'custom', message: 'Public OpenCode models require the native endpoint, a free model and prompt judgement disabled', path: ['authentication'] });
  }
});
export const modelSettingsInputSchema = modelSettingsSchema.safeExtend({ apiKey: z.string().optional() });
export const modelSettingsViewSchema = modelSettingsSchema.safeExtend({ hasKey: z.boolean(), source: z.enum(['keychain', 'environment', 'trial']).optional() });
export type ModelSettings = z.infer<typeof modelSettingsSchema>;
export type ModelSettingsInput = z.infer<typeof modelSettingsInputSchema>;
export type ModelSettingsView = z.infer<typeof modelSettingsViewSchema>;
export function isModelConfigured(settings: ModelSettingsView | null | undefined): boolean {
  return Boolean(settings && settings.authentication !== 'opencode-public' && settings.hasKey);
}

// Discovery never includes credentials, provider options, or raw configuration.
export const openCodeModelsSchema = z.strictObject({
  schema: z.literal(1),
  models: z.array(z.strictObject({
    id: z.string().min(1), provider: z.string().min(1), model: z.string().min(1), name: z.string().min(1),
    isDefault: z.boolean(), available: z.boolean(), reason: z.string().optional()
  }))
});
export type OpenCodeModels = z.infer<typeof openCodeModelsSchema>;
export const factoryzePublicModelMessage = 'OpenCode’s keyless free models are restricted to OpenCode and cannot be used by Factoryze. Select an API-key connection such as OpenRouter, or configure a local model.';

// Draft in-process harness seam. No provider credentials or private task files cross it.
export const harnessToolInputs = {
  read: z.strictObject({ filePath: z.string().min(1) }),
  list: z.strictObject({ path: z.string().optional() }),
  grep: z.strictObject({ query: z.string().min(1), path: z.string().optional() }),
  edit: z.strictObject({ filePath: z.string().min(1), oldString: z.string().min(1), newString: z.string() }),
  write: z.strictObject({ filePath: z.string().min(1), content: z.string().max(64000) }),
  shell: z.strictObject({ command: z.string().min(1).max(8000) })
};
const harnessToolDescriptions = { read: 'Read a UTF-8 workspace file.', list: 'List workspace files, excluding generated folders.',
  grep: 'Find literal text in workspace files.', edit: 'Replace one exact, unique string in a file. Shows an approval diff.',
  write: 'Create or replace a file. Shows an approval diff.', shell: 'Run a command in the workspace after approval.' };
export const harnessToolDefinitions = Object.entries(harnessToolInputs).map(([name, schema]) => {
  const { $schema, ...parameters } = z.toJSONSchema(schema);
  return { name, description: harnessToolDescriptions[name as keyof typeof harnessToolDescriptions], parameters };
});
export const harnessToolCallSchema = z.strictObject({
  id: z.string().min(1), name: z.enum(['read', 'list', 'grep', 'edit', 'write', 'shell']),
  arguments: z.record(z.string(), z.unknown())
});
export type HarnessToolCall = z.infer<typeof harnessToolCallSchema>;
export type AgentUpdate = { sessionUpdate: 'agent_message_chunk'; content: { type: 'text'; text: string } } |
  { sessionUpdate: 'tool_call' | 'tool_call_update'; toolCallId: string; kind: 'read' | 'search' | 'edit' | 'execute'; title: string; status: 'in_progress' | 'completed' | 'failed' };
export type AgentPermission = {
  toolCall: { toolCallId: string; kind: 'edit' | 'execute'; title: string; rawInput: Record<string, unknown>;
    content?: { type: 'diff'; path: string; oldText: string; newText: string }[] };
  options: { optionId: string; kind: 'allow_once' | 'reject_once'; name: string }[];
};

// Additive draft lab control protocol. This does not freeze the later tool/mirror protocol.
export const LAB_PROTOCOL_VERSION = 1;
export const labStudentIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const labCreateSchema = z.strictObject({
  schema: z.literal(1),
  config: labConfigSchema.extend({ task: identifier, timeLimitMinutes: z.number().int().min(1).max(1440) }),
  providerHost: z.string().max(253).regex(/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/),
  temperature: z.literal(0),
  roster: z.array(labStudentIdSchema).min(1).max(200)
}).refine(value => new Set(value.roster).size === value.roster.length, 'Roster identifiers must be unique');
export type LabCreate = z.infer<typeof labCreateSchema>;
export const labClientConfigSchema = z.strictObject({
  schema: z.literal(1), protocol: z.literal(1),
  baseURL: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/';
  }, 'An HTTPS server origin is required'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  certificate: z.string().max(16000).regex(/^-----BEGIN CERTIFICATE-----\r?\n[\s\S]+\r?\n-----END CERTIFICATE-----\r?\n?$/)
});
export type LabClientConfig = z.infer<typeof labClientConfigSchema>;
export const labJoinRequestSchema = z.strictObject({
  protocol: z.literal(1), lab: identifier, code: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  studentId: labStudentIdSchema, profile: profileVersion, binding:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()
});
export type LabJoinRequest = z.infer<typeof labJoinRequestSchema>;
export const labStudentStateSchema = z.strictObject({
  protocol: z.literal(1), lab: identifier, studentId: labStudentIdSchema, task: identifier,
  profile: profileVersion, model: z.string().min(1), providerHost: z.string().min(1), temperature: z.literal(0),
  permissions: z.strictObject({ edit: z.literal('ask'), shell: z.literal('ask') }),
  state: z.enum(['open', 'closed']), closesAt: z.iso.datetime(), closedAt: z.iso.datetime().nullable(), usage: usageTotalsSchema
});
export type LabStudentState = z.infer<typeof labStudentStateSchema>;
export const labJoinResponseSchema = z.strictObject({
  protocol: z.literal(1), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), expiresAt: z.iso.datetime(), state: labStudentStateSchema
});
export type LabJoinResponse = z.infer<typeof labJoinResponseSchema>;
export const labOverviewSchema = z.strictObject({
  protocol: z.literal(1), config: labConfigSchema, providerHost: z.string(), temperature: z.literal(0),
  createdAt: z.iso.datetime(), closesAt: z.iso.datetime(), closedAt: z.iso.datetime().nullable(),
  students: z.array(z.strictObject({ studentId: labStudentIdSchema, joined: z.boolean(), usage: usageTotalsSchema.nullable() }))
});
export type LabOverview = z.infer<typeof labOverviewSchema>;

export function isLabFilePath(path: string): boolean {
  if (path.length > 240 || !/^[A-Za-z0-9._ /-]+$/.test(path) || path.includes('\\')) return false;
  const parts = path.split('/');
  return parts.every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
    !['.git', '.venv', 'node_modules', '__pycache__', '.pytest_cache'].includes(part.toLowerCase()) &&
    !/^\.env(?:\.|$)/i.test(part) && !part.toLowerCase().startsWith('.factoryze')) &&
    !path.toLowerCase().startsWith('tests/hidden/');
}
export const labFileSchema = z.strictObject({ path: z.string().refine(isLabFilePath, 'Unsafe lab file path'),
  data: z.string().max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) });
export type LabFile = z.infer<typeof labFileSchema>;
export const labTaskBundleSchema = z.strictObject({ task: taskPackSchema, files: z.array(labFileSchema).max(512), hash: z.string().regex(/^[a-f0-9]{64}$/) });
export type LabTaskBundle = z.infer<typeof labTaskBundleSchema>;
export const labMirrorSchema = z.strictObject({ revision: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(labFileSchema).max(512) });
export type LabMirror = z.infer<typeof labMirrorSchema>;
export const labSyncSchema = z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), baseRevision: z.number().int().nonnegative(), files: z.array(labFileSchema).max(512) });
export type LabSync = z.infer<typeof labSyncSchema>;
export const labSubmissionSchema = z.strictObject({ id: z.string(), number: z.number().int().positive(), revision: z.number().int().nonnegative(),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/), submittedAt: z.iso.datetime(), state: z.enum(['queued', 'grading', 'graded', 'failed']), released: z.boolean() });
export type LabSubmission = z.infer<typeof labSubmissionSchema>;
export const labSubmitSchema = z.strictObject({ requestId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), revision: z.number().int().nonnegative() });
export const labClientEventSchema = z.strictObject({ id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), kind: z.enum(['paste', 'focus_lost']), at: z.iso.datetime(), count: z.number().int().min(0).max(1000000) });
export type LabClientEvent = z.infer<typeof labClientEventSchema>;
export const labAgentEventSchema = z.strictObject({ sequence: z.number().int().positive(), kind: z.enum(['update','tool','usage','assessment','complete','error']),
  data: z.unknown() });
export type LabAgentEvent = z.infer<typeof labAgentEventSchema>;
const labOperationId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const labAgentStartSchema = z.strictObject({ revision:z.number().int().nonnegative(), connectionId:labOperationId });
export const labAgentPromptSchema = z.strictObject({ session:labOperationId, requestId:labOperationId, revision:z.number().int().nonnegative(), text:z.string().trim().min(1).max(64000) });
export const labAgentPollSchema = z.strictObject({ session:labOperationId, after:z.number().int().nonnegative() });
export const labAgentResultSchema = z.strictObject({ session:labOperationId, id:labOperationId, revision:z.number().int().nonnegative(),
  result:z.string().max(16000), approvals:z.array(z.strictObject({toolCallId:z.string().max(100),kind:z.enum(['edit','execute']),approved:z.boolean(),outcome:z.enum(['allow_once','reject_once','cancelled'])})).max(1) });
export const labDesktopJoinSchema=z.strictObject({connection:labClientConfigSchema,lab:identifier,studentId:labStudentIdSchema,
  code:z.string().max(100),recoveryToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()});
export type LabDesktopJoin=z.infer<typeof labDesktopJoinSchema>;
export type LabDesktopStatus={lab:string;studentId:string;model:string;state:'open'|'closed';closesAt:string;offline:boolean;inference:boolean;grading:boolean;usage:UsageTotals;submissions:LabSubmission[]};
export const gradingProvenanceSchema=z.strictObject({executor:z.literal('docker'),image:z.string().regex(/^sha256:[a-f0-9]{64}$/),
  runner:z.literal('factoryze-hidden-v1'),python:z.string().regex(/^3\.\d+\.\d+$/),checkTimeoutMs:z.number().int().positive().max(120000),runTimeoutMs:z.number().int().positive().max(120000)});
export type GradingProvenance=z.infer<typeof gradingProvenanceSchema>;
export const labGradingStatusSchema=z.strictObject({protocol:z.literal(1),lab:identifier,
  submissions:z.array(labSubmissionSchema.extend({studentId:labStudentIdSchema,provenance:gradingProvenanceSchema.optional()}))});
export type LabGradingStatus=z.infer<typeof labGradingStatusSchema>;
