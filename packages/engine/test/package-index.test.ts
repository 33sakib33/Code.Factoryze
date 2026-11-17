import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { startPackageIndex, pinPythonIndex } from '../src/package-index.ts';

test('engine package index serves only curated wheels and pins pip without a fallback index', async () => {
  const root = mkdtempSync(join(tmpdir(), 'factoryze-index-'));
  const wheels = join(root, 'wheels'); mkdirSync(wheels);
  writeFileSync(join(wheels, 'demo_pkg-1.0-py3-none-any.whl'), 'synthetic-wheel');
  writeFileSync(join(root, 'private.txt'), 'private');
  // Windows can require a privilege unavailable to CI runners; never bypass that restriction.
  try { symlinkSync(join(root, 'private.txt'), join(wheels, 'linked-1.0-py3-none-any.whl')); }
  catch (error) { if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error; }
  const index = await startPackageIndex(wheels);
  try {
    const listing = await (await fetch(`${index.url}demo-pkg/`)).text();
    assert.match(listing, /demo_pkg-1.0-py3-none-any.whl#sha256=/);
    assert.equal((await fetch(`${index.url}unknown/`)).status, 404);
    assert.equal((await fetch(`${index.url}linked/`)).status, 404);
    assert.equal((await fetch(`${index.url}..%2fprivate.txt`)).status, 404);
    const env = await pinPythonIndex(root, index.url, join(root, 'engine-pip.ini'));
    assert.equal(env.PIP_INDEX_URL, index.url);
    assert.equal(env.PIP_EXTRA_INDEX_URL, '');
    const config = readFileSync(join(root, '.venv', process.platform === 'win32' ? 'pip.ini' : 'pip.conf'), 'utf8');
    assert.match(config, /index-url = http:\/\/127.0.0.1:/);
    assert.match(config, /extra-index-url =\s*\n/);
  } finally { await index.close(); rmSync(root, { recursive: true, force: true }); }
});
