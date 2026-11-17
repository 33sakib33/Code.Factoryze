import {z} from 'zod';

// Private, unreleased worker contract. Never accept these jobs directly from a browser.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^[a-f0-9]{24}$/);
const image = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const path = z.string().max(180).regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/)
  .refine(value => value.split('/').every(part => part !== '..' && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) && !part.endsWith('.')));
const byteLength = (text: string) => new TextEncoder().encode(text).length;
const textFile = z.strictObject({path, content: z.string().max(65536).refine(value => !value.includes('\0') &&
  ![...value].some(char => {const point = char.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff;}) && byteLength(value) <= 65536)});
function files(maxBytes: number) {
  return z.array(textFile).min(1).max(10).superRefine((entries, ctx) => {
    const paths = entries.map(file => file.path.toLowerCase()), names = new Set(paths);
    if (names.size !== paths.length || paths.some(path => path.split('/').slice(0, -1).some((_, i, parts) => names.has(parts.slice(0, i + 1).join('/')))))
      ctx.addIssue({code: 'custom', message: 'Duplicate file or directory conflict'});
    if (entries.reduce((total, file) => total + byteLength(file.content), 0) > maxBytes)
      ctx.addIssue({code: 'custom', message: 'Snapshot exceeds byte limit'});
  });
}
export const browserCheckInputSchema = z.strictObject({
  schema: z.literal(1), kind: z.literal('public_checks'), jobId: id, attemptId: id,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), archiveHash: hash, image,
  minimumPython: z.string().regex(/^3\.\d{1,2}$/), files: files(262144),
  publicChecks: files(131072).refine(entries => entries.every(file => /^tests\/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*test_[A-Za-z0-9_-]+\.py$/.test(file.path)))
});
export const browserCheckJobSchema = browserCheckInputSchema.extend({inputHash: hash});
export type BrowserCheckInput = z.infer<typeof browserCheckInputSchema>;
export type BrowserCheckJob = z.infer<typeof browserCheckJobSchema>;
export const browserCheckResultSchema = z.strictObject({
  schema: z.literal(1), kind: z.literal('public_checks'), jobId: id, attemptId: id,
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), inputHash: hash,
  status: z.enum(['completed', 'failed', 'cancelled']), trust: z.literal('practice'), rewardEligible: z.literal(false),
  passed: z.number().int().min(0).max(20), total: z.number().int().min(0).max(20),
  checks: z.array(z.strictObject({name: z.string().max(260).regex(/^tests\/[A-Za-z0-9_./-]+::test_[A-Za-z0-9_]+$/),
    passed: z.boolean(), outcome: z.enum(['passed', 'did_not_pass', 'timeout', 'output_limit', 'memory_limit', 'run_limit'])})).max(20),
  failure: z.enum(['execution_unavailable', 'invalid_checks', 'incompatible_python', 'cancelled']).optional(),
  provenance: z.strictObject({executor: z.literal('docker'), image, runner: z.literal('factoryze-browser-public-v1'),
    python: z.string().regex(/^3\.\d{1,2}\.\d{1,3}$/), checkTimeoutMs: z.literal(5000), runTimeoutMs: z.literal(60000)})
}).refine(result => result.status === 'completed'
  ? !result.failure && result.total > 0 && result.checks.length === result.total && result.passed === result.checks.filter(check => check.passed).length &&
    new Set(result.checks.map(check => check.name)).size === result.total && result.checks.every(check => check.passed === (check.outcome === 'passed'))
  : result.total === 0 && result.passed === 0 && result.checks.length === 0 &&
    (result.status === 'cancelled' ? result.failure === 'cancelled' : !!result.failure && result.failure !== 'cancelled'));
export type BrowserCheckResult = z.infer<typeof browserCheckResultSchema>;

const workerId = z.string().regex(/^[a-z0-9-]{8,64}$/);
export const browserCheckLeaseRequestSchema = z.strictObject({workerId, image});
export const browserCheckLeaseSchema = z.strictObject({leaseToken: hash, leaseExpiresAt: z.iso.datetime(), job: browserCheckJobSchema});
export const browserCheckLeaseResponseSchema = z.strictObject({lease: browserCheckLeaseSchema.nullable()});
export const browserCheckHeartbeatSchema = z.strictObject({workerId, leaseToken: hash});
export const browserCheckFinishSchema = browserCheckHeartbeatSchema.extend({result: browserCheckResultSchema});
export type BrowserCheckLease = z.infer<typeof browserCheckLeaseSchema>;
export const browserWorkerHealthSchema = z.strictObject({ready:z.literal(true),image,trust:z.literal('practice')});
