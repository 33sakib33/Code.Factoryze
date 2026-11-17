import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { recordBenchmark } from '../../engine/src/benchmark.ts';
import { soloSettings } from '../../engine/src/solo.ts';
import { listPracticeTasks } from '../../engine/src/tasks.ts';
import { HarnessSession } from '../../engine/src/harness.ts';
import { HarnessTools } from '../extensions/core/src/node/harness-tools.ts';

const usage = 'Usage: pnpm bench:record --profile factoryze [--task TASK_ID]\n';

function argumentsFor(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  let profile;
  let taskId;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value || !['--profile', '--task'].includes(flag)) throw new Error(usage.trim());
    if (flag === '--profile') profile = value;
    else taskId = value;
  }
  if (profile !== 'factoryze') throw new Error('Only the factoryze profile is supported.\n' + usage.trim());
  return { taskId };
}

async function main() {
  const args = argumentsFor(process.argv.slice(2));
  if (args.help) { process.stdout.write(usage); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Benchmark recording needs an interactive terminal for agent permissions');

  const packRoot = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
  const tasks = await listPracticeTasks(packRoot, { includeRetired: Boolean(args.taskId) });
  const selected = args.taskId ? tasks.filter(task => task.id === args.taskId) : tasks;
  if (!selected.length) throw new Error(`Unknown practice task: ${args.taskId}`);
  const settings = soloSettings();
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const task of selected) {
      process.stdout.write(`Recording ${task.id} on ${settings.model}\n`);
      const { file, baseline } = await recordBenchmark({ packRoot, outputRoot: packRoot, taskId: task.id, settings,
        run: async ({ scenario, workspace, connection, prompts, recordTurn, checkBudget }) => {
          let permissionCancelled = false;
          const permission = async params => {
            const options = Array.isArray(params?.options) ? params.options : [];
            process.stdout.write(`\nAgent permission request:\n${JSON.stringify(params, null, 2)}\n`);
            for (const [index, option] of options.entries())
              process.stdout.write(`${index + 1}. ${option.kind ?? option.optionId}\n`);
            const answer = await terminal.question('Choose an option number (Enter cancels): ');
            const index = Number(answer) - 1;
            if (!Number.isInteger(index) || index < 0 || index >= options.length || typeof options[index].optionId !== 'string') {
              permissionCancelled = true; return null;
            }
            return options[index].optionId;
          };
          const hands = new HarnessTools({ cwd: workspace, gateway: connection, onPermission: permission });
          const session = new HarnessSession({ gateway: connection, checkBudget,
            onUpdate: () => {}, execute: (call, signal) => hands.execute(call, signal) });
          try {
            await session.start();
            for (const prompt of prompts) {
              process.stdout.write(`[${scenario}] ${prompt}\n`);
              const reason = await session.prompt(prompt);
              if (reason !== 'end_turn') throw new Error(`Factoryze stopped the ${scenario} run: ${reason}`);
              if (permissionCancelled) throw new Error(`Benchmark ${scenario} run was cancelled at a permission request`);
              recordTurn();
            }
          } finally { session.stop(); }
        } });
      process.stdout.write(`Saved ${file}\nExpert: ${baseline.expert.correctness.passed}/${baseline.expert.correctness.total}, ${baseline.expert.weightedTokens} weighted tokens\nNaive: ${baseline.naive.correctness.passed}/${baseline.naive.correctness.total}, ${baseline.naive.weightedTokens} weighted tokens\n`);
    }
  } finally { terminal.close(); }
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
