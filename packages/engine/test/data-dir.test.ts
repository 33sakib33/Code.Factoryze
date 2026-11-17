import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { factoryzeDataDir, migrateFactoryzeDataDir, platformDataDir } from '../src/data-dir.ts';

function fixture(home: string) {
  const platform = process.platform;
  const env = platform === 'win32' ? { LOCALAPPDATA: join(home, 'native') }
    : platform === 'darwin' ? {} : { XDG_DATA_HOME: join(home, 'native') };
  return { platform, env, old: join(home, '.factoryze'), native: platformDataDir(platform, home, env) };
}

test('desktop data uses each platform data location', () => {
  assert.equal(platformDataDir('darwin', '/Users/ada', {}), '/Users/ada/Library/Application Support/Factoryze/engine');
  assert.equal(platformDataDir('win32', 'C:\\Users\\Ada', { LOCALAPPDATA: 'D:\\Profile\\Ada\\AppData\\Local' }), 'D:\\Profile\\Ada\\AppData\\Local\\Factoryze\\engine');
  assert.equal(platformDataDir('win32', 'C:\\Users\\Ada', {}), 'C:\\Users\\Ada\\AppData\\Local\\Factoryze\\engine');
  assert.equal(platformDataDir('linux', '/home/ada', { XDG_DATA_HOME: '/data/ada' }), '/data/ada/factoryze/engine');
  assert.equal(platformDataDir('linux', '/home/ada', { XDG_DATA_HOME: 'relative/data' }), '/home/ada/.local/share/factoryze/engine');
});

test('an existing legacy data directory is moved before the new path is used', () => {
  const home = mkdtempSync(join(tmpdir(), 'factoryze-data-migration-'));
  try {
    const { platform, env, old, native } = fixture(home);
    mkdirSync(join(old, 'task-packs', 'digest'), { recursive: true });
    writeFileSync(join(old, 'usage.sqlite'), 'existing usage');
    writeFileSync(join(old, 'task-packs', 'digest', 'task.yaml'), 'existing task');
    assert.equal(factoryzeDataDir({ platform, home, env }), native);
    assert.equal(existsSync(old), true);
    const selected = migrateFactoryzeDataDir({ platform, home, env });
    assert.equal(selected, native);
    assert.equal(readFileSync(join(selected, 'usage.sqlite'), 'utf8'), 'existing usage');
    assert.equal(readFileSync(join(selected, 'task-packs', 'digest', 'task.yaml'), 'utf8'), 'existing task');
    assert.equal(existsSync(old), false);
    assert.equal(migrateFactoryzeDataDir({ platform, home, env }), selected);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('macOS migration keeps Electron user data beside the engine directory', { skip: process.platform !== 'darwin' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'factoryze-mac-data-'));
  try {
    const old = join(home, '.factoryze');
    const appData = join(home, 'Library', 'Application Support', 'Factoryze');
    mkdirSync(old);
    mkdirSync(appData, { recursive: true });
    writeFileSync(join(old, 'usage.sqlite'), 'existing usage');
    writeFileSync(join(appData, 'Preferences'), 'electron settings');
    const selected = migrateFactoryzeDataDir({ platform: 'darwin', home, env: {} });
    assert.equal(selected, join(appData, 'engine'));
    assert.equal(readFileSync(join(selected, 'usage.sqlite'), 'utf8'), 'existing usage');
    assert.equal(readFileSync(join(appData, 'Preferences'), 'utf8'), 'electron settings');
    assert.equal(existsSync(old), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('an explicit data directory wins and conflicting stores are not silently selected', () => {
  const home = mkdtempSync(join(tmpdir(), 'factoryze-data-selection-'));
  try {
    const { platform, env, old, native } = fixture(home);
    mkdirSync(old); mkdirSync(native, { recursive: true });
    writeFileSync(join(old, 'usage.sqlite'), 'old');
    writeFileSync(join(native, 'usage.sqlite'), 'new');
    assert.throws(() => migrateFactoryzeDataDir({ platform, home, env }), /both.*data directories/i);
    assert.equal(readFileSync(join(native, 'usage.sqlite'), 'utf8'), 'new');
    assert.equal(readFileSync(join(old, 'usage.sqlite'), 'utf8'), 'old');
    const custom = join(home, 'managed');
    assert.equal(migrateFactoryzeDataDir({ platform, home, env: { FACTORYZE_DATA_DIR: custom } }), custom);
    assert.equal(existsSync(custom), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('an empty native directory does not hide legacy data', () => {
  const home = mkdtempSync(join(tmpdir(), 'factoryze-data-empty-'));
  try {
    const { platform, env, old, native } = fixture(home);
    mkdirSync(old); mkdirSync(native, { recursive: true });
    writeFileSync(join(old, 'usage.sqlite'), 'existing');
    assert.equal(migrateFactoryzeDataDir({ platform, home, env }), native);
    assert.equal(readFileSync(join(native, 'usage.sqlite'), 'utf8'), 'existing');
    assert.equal(existsSync(old), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('failed migration leaves the legacy directory intact', () => {
  const home = mkdtempSync(join(tmpdir(), 'factoryze-data-failure-'));
  try {
    const { platform, env, old, native } = fixture(home);
    mkdirSync(old); writeFileSync(join(old, 'usage.sqlite'), 'existing');
    mkdirSync(dirname(dirname(native)), { recursive: true });
    writeFileSync(dirname(native), 'not a directory');
    assert.throws(() => migrateFactoryzeDataDir({ platform, home, env }));
    assert.equal(readFileSync(join(old, 'usage.sqlite'), 'utf8'), 'existing');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('an intentional legacy directory link stays in use', () => {
  const home = mkdtempSync(join(tmpdir(), 'factoryze-data-link-'));
  try {
    const custom = join(home, 'managed');
    const { platform, env, old: legacy } = fixture(home);
    mkdirSync(custom);
    symlinkSync(custom, legacy, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(factoryzeDataDir({ platform, home, env }), legacy);
    assert.equal(migrateFactoryzeDataDir({ platform, home, env }), legacy);
    assert.equal(existsSync(custom), true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
