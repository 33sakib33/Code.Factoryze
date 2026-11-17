import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureBenchmarkVariance } from '../../engine/src/benchmark.ts';
import { listPracticeTasks } from '../../engine/src/tasks.ts';
import { HarnessSession } from '../../engine/src/harness.ts';
import { isBenchmarkTestCommand } from './benchmark-approval.mjs';
import { HarnessTools } from '../extensions/core/src/node/harness-tools.ts';
import { ModelSettingsStore } from '../extensions/core/src/node/model-settings.ts';

const usage = 'Usage: pnpm bench:variance [--pack practice|benchmark] [--task TASK_ID] [--runs 10] [--temperature 0|default] [--model PROVIDER_MODEL_ID]\n';
// Unattended runs approve edits (they stay in a disposable workspace) and only plain test-runner commands.

function argumentsFor(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const args = { pack: 'practice', runs: 10, temperature: 0 };
  for (let index = 0; index < argv.length; index += 2) {
    const [flag, value] = [argv[index], argv[index + 1]];
    if (!value) throw new Error(usage.trim());
    if (flag === '--pack') args.pack = value;
    else if (flag === '--task') args.taskId = value;
    else if (flag === '--runs') args.runs = Number(value);
    else if (flag === '--model') args.model = value;
    else if (flag === '--temperature') args.temperature = value === 'default' ? undefined : Number(value);
    else throw new Error(usage.trim());
  }
  if (!['practice', 'benchmark'].includes(args.pack)) throw new Error('--pack must be practice or benchmark');
  if (!Number.isSafeInteger(args.runs) || args.runs < 1 || args.runs > 50) throw new Error('--runs must be 1 to 50');
  if (args.temperature !== undefined && !(args.temperature >= 0 && args.temperature <= 2)) throw new Error('--temperature must be 0 to 2 or "default"');
  return args;
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage); return; }
  const saved = await new ModelSettingsStore().forEngine();
  if (!saved) throw new Error('Connect a model in Factoryze Settings, or set FACTORYZE_PROVIDER_URL, FACTORYZE_MODEL and FACTORYZE_PROVIDER_API_KEY.');
  // Prompt feedback and the attempt budget would change what is measured.
  // --model reuses the saved connection's provider and key with another model ID from the same provider.
  const settings = { ...saved, ...(args.model ? { model: args.model } : {}), temperature: args.temperature, modules: undefined, judgeModel: undefined, budget: { ...saved.budget, limit: 1_000_000 } };
  const packRoot = fileURLToPath(new URL(`../../../tasks/${args.pack}/`, import.meta.url));
  const tasks = (await listPracticeTasks(packRoot, { includeRetired: Boolean(args.taskId) })).filter(task => !args.taskId || task.id === args.taskId);
  if (!tasks.length) throw new Error(`Unknown practice task: ${args.taskId}`);
  const output = fileURLToPath(new URL('../../../dist/bench-variance/', import.meta.url));
  await mkdir(output, { recursive: true });

  for (const task of tasks) {
    process.stdout.write(`${task.id}: ${args.runs} runs of each prompt script on ${settings.model}, temperature ${args.temperature ?? 'provider default'}\n`);
    const shell = [];
    const result = await measureBenchmarkVariance({ packRoot, taskId: task.id, settings, runs: args.runs, temperature: args.temperature,
      run: async ({ scenario, workspace, connection, prompts, recordTurn, checkBudget, temperature }) => {
        const permission = async ({ toolCall }) => {
          const allowed = toolCall.kind === 'edit' || (toolCall.kind === 'execute' && isBenchmarkTestCommand(toolCall.title));
          if (toolCall.kind === 'execute') shell.push({ scenario, command: toolCall.title, approved: allowed });
          return allowed ? 'allow' : 'reject';
        };
        const hands = new HarnessTools({ cwd: workspace, gateway: connection, onPermission: permission });
        const session = new HarnessSession({ gateway: connection, checkBudget, temperature,
          onUpdate: () => {}, execute: (call, signal) => hands.execute(call, signal) });
        try {
          await session.start();
          for (const prompt of prompts) {
            const reason = await session.prompt(prompt);
            if (reason !== 'end_turn') throw new Error(`Factoryze stopped the ${scenario} run: ${reason}`);
            recordTurn();
          }
        } finally { session.stop(); }
        process.stdout.write({ expert: '.', middle: '-', naive: ':' }[scenario]);
      } });
    const file = join(output, `${task.id}-${encodeURIComponent(settings.model)}-${result.recordedAt.replace(/[:.]/g, '-')}.json`);
    await writeFile(file, `${JSON.stringify({ ...result, shell }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    const line = name => { const s = result.summary[name];
      return `${name.padEnd(6)} completed ${s.completed}/${args.runs}, solved ${s.solved}, weighted tokens min ${s.min} / median ${s.median} / max ${s.max}, stdev ${s.stdev}\n`; };
    process.stdout.write(`\n${line('expert')}${result.summary.middle ? line('middle') : ''}${line('naive')}separated: ${result.summary.separated}\nSaved ${file}\n`);
  }
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
