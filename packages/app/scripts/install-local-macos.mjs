import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('This helper installs the local macOS preview only');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = join(repo, 'dist');
const built = join(dist, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Factoryze.app');
const installed = '/Applications/Factoryze.app';
const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const check = app => {
  const id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  if (id !== 'com.factoryze.desktop') throw new Error(`Unexpected app identity: ${app}`);
};
check(built);
execFileSync('codesign', ['--verify', '--deep', '--strict', built]);
if (existsSync(installed)) throw new Error('Factoryze is already installed in Applications; preserve it and update through the DMG');
execFileSync('ditto', [built, installed]);
execFileSync('codesign', ['--verify', '--deep', '--strict', installed]);
const archive = join(dist, '.preview-archive.noindex'); mkdirSync(archive, { recursive: true });
const archived = [];
for (const name of ['settings-icon-preview', 'titlebar-preview']) {
  const source = join(dist, name);
  const app = join(source, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Factoryze.app');
  if (!existsSync(app)) continue;
  check(app); execFileSync(lsregister, ['-u', app]);
  const destination = join(archive, `${name}-${Date.now()}`);
  renameSync(source, destination); archived.push(destination);
}
writeFileSync(join(dist, '.metadata_never_index'), '');
execFileSync(lsregister, ['-u', built]);
execFileSync(lsregister, ['-f', installed]);
console.log(JSON.stringify({ installed, archived, buildCopyUnregistered: built }));
