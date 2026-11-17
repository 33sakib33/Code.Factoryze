import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { benchmarkPromptsSchema, taskPackSchema, type BenchmarkPrompts, type TaskPack } from '@factoryze/protocol';

async function loadTask(packDir: string): Promise<TaskPack> {
  const text = await readFile(join(packDir, 'task.yaml'), 'utf8');
  return taskPackSchema.parse(parse(text));
}

export async function listPracticeTasks(packRoot: string, options: { includeRetired?: boolean } = {}): Promise<TaskPack[]> {
  const entries = await readdir(packRoot, { withFileTypes: true });
  const directories = entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const tasks = await Promise.all(directories.map(async entry => {
    const task = await loadTask(join(packRoot, entry.name));
    if (task.id !== entry.name) throw new Error(`Task ID does not match folder: ${entry.name}`);
    return task;
  }));
  return options.includeRetired ? tasks : tasks.filter(task => !task.retired);
}

export async function loadBenchmarkPrompts(packRoot: string, taskId: string): Promise<BenchmarkPrompts> {
  const id = taskPackSchema.shape.id.parse(taskId);
  const text = await readFile(join(packRoot, id, 'prompts', 'benchmark.yaml'), 'utf8');
  const prompts = benchmarkPromptsSchema.parse(parse(text));
  if (prompts.taskId !== id) throw new Error(`Benchmark prompts do not match task: ${id}`);
  return prompts;
}

export async function startPracticeTask(
  packRoot: string, taskId: string, sessionsRoot: string,
  prepare?: (workspace: string, task: TaskPack) => Promise<unknown>,
): Promise<{ task: TaskPack; workspace: string }> {
  const id = taskPackSchema.shape.id.parse(taskId);
  const packDir = join(packRoot, id);
  const task = await loadTask(packDir);
  if (task.id !== id) throw new Error(`Task ID does not match folder: ${id}`);
  const starter = join(packDir, 'workspace');
  if (!(await lstat(starter)).isDirectory()) throw new Error(`Task has no starter workspace: ${id}`);
  await mkdir(sessionsRoot, { recursive: true });
  const workspace = await mkdtemp(join(sessionsRoot, `${id}-`));
  try {
    for (const entry of await readdir(starter)) {
      await cp(join(starter, entry), join(workspace, entry), { recursive: true, force: false, errorOnExist: true });
    }
    await prepare?.(workspace, task);
    return { task, workspace };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}
