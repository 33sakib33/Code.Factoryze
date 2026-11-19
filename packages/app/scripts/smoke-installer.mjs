import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupWindowsInstaller } from './installer-cleanup.mjs';

// Install/extract into a disposable directory before driving the packaged app.
// OS quarantine/SmartScreen prompts still require the separate manual release checklist.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = join(repo, 'dist');
const root = mkdtempSync(join(tmpdir(), 'factoryze-installer-smoke-'));
let mounted = false;
let soloSmokePassed=false,labSmokePassed=false;
let smokeError, cleanupError, windowsCleanup;
const linuxFormat = process.env.FACTORYZE_LINUX_INSTALLER || 'AppImage';
if (process.platform === 'linux' && !['AppImage', 'deb', 'rpm'].includes(linuxFormat)) {
  throw new Error(`Unsupported Linux installer format: ${linuxFormat}`);
}
try {
  const extension = process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : `.${linuxFormat}`;
  const installer = readdirSync(dist).filter(name => name.endsWith(extension));
  if (installer.length !== 1) throw new Error(`Expected one ${extension} installer; found ${installer.length}`);
  let executable;
  if (process.platform === 'darwin') {
    const mount = join(root, 'volume');
    execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, join(dist, installer[0])]); mounted = true;
    execFileSync('ditto', [join(mount, 'Factoryze.app'), join(root, 'Factoryze.app')]);
    execFileSync('hdiutil', ['detach', mount]); mounted = false;
    executable = join(root, 'Factoryze.app/Contents/MacOS/Factoryze');
    execFileSync('codesign', ['--verify', '--deep', '--strict', join(root, 'Factoryze.app')]);
  } else if (process.platform === 'win32') {
    const install = join(root, 'installed');
    const setup = join(dist, installer[0]);
    // Like _?= during uninstall, NSIS /D= consumes the final unquoted path.
    execFileSync(setup, ['/S', `/D=${install}`], { timeout: 120_000,
      windowsVerbatimArguments: true, argv0: `"${setup}"` });
    executable = join(install, 'Factoryze.exe');
  } else if (linuxFormat === 'AppImage') {
    execFileSync(join(dist, installer[0]), ['--appimage-extract'], { cwd: root, stdio: 'ignore', timeout: 120_000 });
    executable = join(root, 'squashfs-root/factoryze');
  } else {
    const packagePath = join(dist, installer[0]);
    if (linuxFormat === 'deb') {
      execFileSync('dpkg-deb', ['-x', packagePath, root], { timeout: 120_000 });
    } else {
      execFileSync('bash', ['-c', 'set -euo pipefail; rpm2cpio "$1" | cpio -id --quiet', '--', packagePath], { cwd: root, timeout: 120_000 });
    }
    const opt = join(root, 'opt');
    const candidates = existsSync(opt) ? readdirSync(opt).map(name => join(opt, name, 'factoryze')) : [];
    executable = candidates.find(path => existsSync(path) && statSync(path).isFile() && (statSync(path).mode & 0o111));
    if (!executable) throw new Error(`${linuxFormat} package has no executable Factoryze app under /opt`);
  }
  execFileSync(process.execPath, ['--experimental-strip-types', join(repo, 'packages/app/scripts/smoke-solo.mjs')], {
    env: { ...process.env, FACTORYZE_SMOKE_EXECUTABLE: executable }, stdio: 'inherit', timeout: 360_000,
  });
  soloSmokePassed=true;
  execFileSync(process.execPath, ['--experimental-strip-types', join(repo, 'packages/app/scripts/smoke-lab.mjs')], {
    env: { ...process.env, FACTORYZE_SMOKE_EXECUTABLE: executable }, stdio: 'inherit', timeout: 360_000,
  });
  labSmokePassed=true;
} catch (error) {
  smokeError = error;
}
try {
  if (process.platform === 'darwin') {
    try { execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-u', join(root, 'Factoryze.app')]); } catch { /* Keep original test outcome. */ }
  }
  if (mounted) execFileSync('hdiutil', ['detach', join(root, 'volume')]);
  if (process.platform === 'win32') {
    windowsCleanup = cleanupWindowsInstaller(root);
  } else {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
} catch (error) {
  cleanupError = error;
}
const output = join(dist, `smoke-${process.platform}${process.platform === 'linux' ? `-${linuxFormat}` : ''}`); mkdirSync(output, { recursive: true });
const receipt = { passed: !smokeError && !cleanupError, platform: process.platform,
  ...(process.platform === 'linux' ? { installerFormat: linuxFormat } : {}),
  soloSmokePassed,labSmokePassed,
  appSmokePassed: !smokeError, cleanupPassed: !cleanupError, temporaryRoot: root,
  temporaryRootRemoved: !existsSync(root), ...(windowsCleanup ?? {}),
  ...(smokeError ? { smokeError: String(smokeError.message ?? smokeError) } : {}),
  ...(cleanupError ? { cleanupError: String(cleanupError.message ?? cleanupError) } : {}) };
writeFileSync(join(output, 'installer-result.json'), JSON.stringify(receipt, null, 2) + '\n');
if (smokeError && cleanupError) throw new AggregateError([smokeError, cleanupError], 'Installed smoke and cleanup both failed');
if (smokeError) throw smokeError;
if (cleanupError) throw cleanupError;
console.log(JSON.stringify(receipt));
