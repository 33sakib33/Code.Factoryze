import type { PracticeTask } from '../common/task-service';

export const untaggedTopic = '__untagged';
export const pageSize = 20;

export function topicLabel(topic: string): string {
  if (topic === untaggedTopic) return 'General';
  if (topic === 'sre') return 'SRE';
  return topic.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function topicFacets(tasks: readonly PracticeTask[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    for (const topic of task.topics?.length ? task.topics : [untaggedTopic]) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  }
  return [...counts].map(([id, count]) => ({ id, count })).sort((a, b) =>
    a.id === untaggedTopic ? 1 : b.id === untaggedTopic ? -1 : b.count - a.count || a.id.localeCompare(b.id));
}

export function browseTasks(tasks: readonly PracticeTask[], options: { topic: string; query: string; page: number; pageSize: number }):
  { items: PracticeTask[]; total: number; page: number; pages: number } {
  const query = options.query.trim().toLocaleLowerCase();
  const matches = tasks.filter(task => {
    const topics = task.topics?.length ? task.topics : [untaggedTopic];
    return (!options.topic || topics.includes(options.topic)) && (!query ||
      [task.title, task.brief, task.id, ...topics, ...(task.recommendedKnowledge ?? [])].some(value => value.toLocaleLowerCase().includes(query)));
  });
  const size = Math.max(1, Math.min(100, Math.floor(options.pageSize) || pageSize));
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const page = Math.min(pages - 1, Math.max(0, Math.floor(options.page) || 0));
  return { items: matches.slice(page * size, (page + 1) * size), total: matches.length, page, pages };
}
