import { reportActivityKinds, reportInsightsSchema, type FactoryzeEvent, type PromptUsage, type ReportInsights } from '@factoryze/protocol';

type Activity = 'exploration' | 'editing' | 'commands';
export type ReportRequest = { id: string; weighted: number; incomplete: boolean };
type Session = { prompt?: string; first: boolean; pending: Set<Activity | 'unknown'> };
type Tool = { activity: Activity; status: 'running' | 'completed' | 'failed' };

/** Reads only ordered metadata and ledger totals. No request bodies, prompt text, paths or commands enter the report. */
export function summarizeReportActivity(events: FactoryzeEvent[], requests: ReportRequest[], prompts: PromptUsage[]): ReportInsights {
  const sessions = new Map<string, Session>(), tools = new Map<string, Tool>(), calls: Tool[] = [];
  const assignments = new Map<string, (typeof reportActivityKinds)[number]>();
  const approvals = { approved: 0, declined: 0, cancelled: 0 };
  const permissions = new Set<string>();
  for (const event of events) {
    let session = sessions.get(event.sessionId);
    if (!session) { session = { first: true, pending: new Set() }; sessions.set(event.sessionId, session); }
    const data = event.data;
    if (event.type === 'prompt_started@1' && typeof data.promptId === 'string') {
      session.prompt = data.promptId; session.first = true; session.pending.clear();
    } else if ((event.type === 'prompt_ended@1' && data.promptId === session.prompt) || event.type === 'session_stopped@1') {
      session.prompt = undefined; session.first = true; session.pending.clear();
    } else if (event.type === 'model_request_started@1' && typeof data.requestId === 'string') {
      if (assignments.has(data.requestId)) continue;
      const kind = !session.prompt || session.pending.has('unknown') ? 'unattributed'
        : session.pending.size > 1 ? 'mixed' : session.pending.size === 1 ? [...session.pending][0] as Activity
          : session.first ? 'prompt' : 'unattributed';
      assignments.set(data.requestId, kind);
      session.first = false; session.pending.clear();
    } else if (event.type === 'acp_update@1' && typeof data.toolCallId === 'string') {
      const key = JSON.stringify([event.sessionId, session.prompt ?? data.promptId ?? '', data.toolCallId]);
      const activity: Activity | undefined = data.kind === 'read' || data.kind === 'search' ? 'exploration'
        : data.kind === 'edit' ? 'editing' : data.kind === 'execute' ? 'commands' : undefined;
      if (data.sessionUpdate === 'tool_call' && data.status === 'in_progress') {
        if (!activity) { session.pending.add('unknown'); continue; }
        if (tools.get(key)?.status === 'running') continue;
        const tool: Tool = { activity, status: 'running' }; tools.set(key, tool); calls.push(tool);
        permissions.delete(key); session.pending.add(activity);
      } else if (data.sessionUpdate === 'tool_call_update' && (data.status === 'completed' || data.status === 'failed')) {
        const tool = tools.get(key);
        if (tool?.status === 'running') tool.status = data.status;
      }
    } else if (event.type === 'permission_decision@1' && typeof data.toolCallId === 'string') {
      const key = JSON.stringify([event.sessionId, session.prompt ?? data.promptId ?? '', data.toolCallId]);
      if (permissions.has(key)) continue;
      permissions.add(key);
      if (data.outcome === 'allow_once' || data.approved === true) approvals.approved++;
      else if (data.outcome === 'reject_once') approvals.declined++;
      else if (data.outcome === 'cancelled') approvals.cancelled++;
    }
  }
  const attribution = reportActivityKinds.map(kind => ({ kind, requests: 0, weighted: 0 }));
  for (const request of requests) {
    const bucket = attribution.find(bucket => bucket.kind === (assignments.get(request.id) ?? 'unattributed'))!;
    bucket.requests++; bucket.weighted += request.weighted;
  }
  for (const bucket of attribution) bucket.weighted = Math.round(bucket.weighted * 1e6) / 1e6;
  const incompleteRequests = requests.filter(request => request.incomplete).length;
  const unfinished = calls.filter(call => call.status === 'running').length;
  const matched = requests.filter(request => assignments.has(request.id) && assignments.get(request.id) !== 'unattributed').length;
  const coverage = requests.length && !matched && !calls.length ? 'unavailable'
    : matched < requests.length || unfinished || incompleteRequests || prompts.some(prompt => prompt.state === 'running') ? 'partial' : 'recorded';
  return reportInsightsSchema.parse({ schema: 1, coverage, prompts,
    tools: { exploration: calls.filter(call => call.activity === 'exploration').length,
      editing: calls.filter(call => call.activity === 'editing').length, commands: calls.filter(call => call.activity === 'commands').length,
      failed: calls.filter(call => call.status === 'failed').length, unfinished },
    approvals, attribution, incompleteRequests });
}
