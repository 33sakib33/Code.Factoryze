import assert from 'node:assert/strict';
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gradePracticeTask, runPracticeTests } from '../src/grader.ts';
import { importTaskPack } from '../src/task-import.ts';
import { listPracticeTasks, loadBenchmarkPrompts, startPracticeTask } from '../src/tasks.ts';

const experimental = fileURLToPath(new URL('../../../tasks/benchmark/', import.meta.url));
const bundled = fileURLToPath(new URL('../../../tasks/practice/', import.meta.url));
const python = process.env.FACTORYZE_PYTHON_BIN ?? (process.platform === 'win32' ? 'python' : 'python3');

test('activity feed stays experimental and its correct-looking starter fails the performance checks', async () => {
  const task = (await listPracticeTasks(experimental)).find(task => task.id === 'activity-feed');
  assert.ok(task);
  assert.equal(task.minimumPython, '3.11');
  assert.equal((await listPracticeTasks(bundled)).some(candidate => candidate.id === task.id), false);
  const prompts = await loadBenchmarkPrompts(experimental, task.id);
  assert.ok(prompts.expert.length && prompts.middle?.length && prompts.naive.length);
  const root = await mkdtemp(join(tmpdir(), 'factoryze-feed-'));
  try {
    const imported = await importTaskPack(join(experimental, task.id), join(root, 'imports'));
    assert.equal(imported.task.id, task.id);
    const { workspace } = await startPracticeTask(imported.packRoot, task.id, join(root, 'sessions'));
    for (const privatePath of ['reference/feed.py', 'tests/hidden/test_feed.py', 'prompts/benchmark.yaml'])
      await assert.rejects(access(join(workspace, privatePath)));
    assert.deepEqual(await runPracticeTests(workspace, python), { passed: 6, total: 6, failures: [] });
    const starter = await gradePracticeTask(experimental, task.id, workspace, python);
    assert.equal(starter.total, 12);
    assert.equal(starter.passed, 8);
    assert.deepEqual(starter.checks!.filter(check => !check.passed).map(check => check.name), [
      'test_distinct_authors_use_bounded_reads', 'test_missing_authors_use_bounded_reads',
      'test_multiple_batches_use_bounded_reads', 'test_repeated_author_is_not_reloaded_per_entry',
    ]);
    await copyFile(join(experimental, task.id, 'reference/feed.py'), join(workspace, 'feed/feed.py'));
    assert.deepEqual(await runPracticeTests(workspace, python), { passed: 6, total: 6, failures: [] });
    const fixed = await gradePracticeTask(experimental, task.id, workspace, python);
    assert.equal(fixed.total, 12);
    assert.equal(fixed.passed, fixed.total, JSON.stringify(fixed.checks));
    assert.match(await readFile(join(workspace, 'feed/feed.py'), 'utf8'), /get_many/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('activity feed checks reject stale caches, cross-workspace names, dropped rows and reordered pages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'factoryze-feed-mutations-'));
  const reference = await readFile(join(experimental, 'activity-feed/reference/feed.py'), 'utf8');
  const mutations = [
    { name: 'persistent cache', check: 'test_new_display_names_are_visible_on_next_request',
      feed: reference.replace('def build_feed(', '_cached = None\n\n\ndef build_feed(')
        .replace('    activities =', '    global _cached\n    if _cached is not None:\n        return _cached\n    activities =')
        .replace('    return [', '    _cached = [') + '\n    return _cached\n' },
    { name: 'unscoped batch lookup', check: 'test_member_ids_are_scoped_to_workspace', repository: true },
    { name: 'dropped former members', check: 'test_deleted_members_keep_entries_on_next_request',
      feed: reference.replace('for activity in activities]', 'for activity in activities if activity.member_id in members]') },
    { name: 'author-sorted page', check: 'test_order_and_limit_apply_to_activity_not_author',
      feed: reference.replace('for activity in activities]', 'for activity in sorted(activities, key=lambda item: item.member_id)]') },
  ];
  try {
    for (const mutation of mutations) {
      const { workspace } = await startPracticeTask(experimental, 'activity-feed', root);
      await writeFile(join(workspace, 'feed/feed.py'), mutation.feed ?? reference);
      if (mutation.repository) {
        const path = join(workspace, 'feed/repository.py');
        const original = await readFile(path, 'utf8');
        const unsafe = original.replace('f"WHERE workspace_id = ? AND id IN ({placeholders})",',
          'f"WHERE id IN ({placeholders})",').replace('(workspace_id, *batch),', 'tuple(batch),');
        assert.notEqual(unsafe, original);
        await writeFile(path, unsafe);
      }
      const result = await gradePracticeTask(experimental, 'activity-feed', workspace, python);
      assert.equal(result.checks!.find(check => check.name === mutation.check)?.passed, false, mutation.name);
      assert.ok(result.checks!.find(check => check.name === mutation.check)?.message?.startsWith('AssertionError'),
        `${mutation.name} should fail behavior, not imports or runtime setup`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
