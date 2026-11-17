import assert from 'node:assert/strict';
import test from 'node:test';
import { agentErrorMessage } from '../src/browser/agent-error.ts';

test('agent errors distinguish task budgets, provider credits and unavailable models without displaying diagnostic JSON', () => {
  const wrapped = (code: string) => new Error(`Internal error: Payment Required: ${JSON.stringify({ error: { type: 'factoryze_gateway_error', code, message: 'synthetic-private-diagnostic' } })}`);
  assert.match(agentErrorMessage(wrapped('budget_exhausted')), /task token budget.*Configuration/i);
  assert.match(agentErrorMessage(wrapped('provider_payment_required')), /provider.*credit/i);
  assert.match(agentErrorMessage(wrapped('provider_model_not_found')), /model ID.*base URL/i);
  assert.equal(agentErrorMessage(wrapped('provider_model_not_found')).includes('synthetic-private'), false);
  assert.match(agentErrorMessage(new Error('Token budget exhausted for this user and task')), /task token budget/i);
  assert.match(agentErrorMessage(new Error('Internal error: Not Found: {"error":{"type":"factoryze_gateway_error","message":"The model provider rejected this request"}}')), /model ID.*base URL/i);
});
