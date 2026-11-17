import type { HostedTask } from '@factoryze/engine/trial-client';
import type { TaskPack } from '@factoryze/protocol';
import type { PracticeTask } from '../common/task-service';

type HostedSource = { hostedTasks(): Promise<HostedTask[]> };

/** Bundled tasks plus the service's enabled hosted tasks. A bundled task keeps its id; a hosted task never shadows it.
 * Hosted listing failures (offline) leave only the bundled tasks. */
export async function practiceTasks(bundled: TaskPack[], source: HostedSource): Promise<{ tasks: PracticeTask[]; hosted: Map<string, HostedTask> }> {
  const ids = new Set(bundled.map(task => task.id));
  const hosted = (await source.hostedTasks().catch(() => [])).filter(task => !ids.has(task.id));
  return { tasks: [...bundled, ...hosted.map(({ sha256: _sha256, archiveBytes: _bytes, ...task }) => ({ ...task, hosted: true as const }))],
    hosted: new Map(hosted.map(task => [task.id, task])) };
}
