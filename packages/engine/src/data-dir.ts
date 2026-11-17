import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

type Environment = Partial<Pick<NodeJS.ProcessEnv, 'FACTORYZE_DATA_DIR' | 'LOCALAPPDATA' | 'XDG_DATA_HOME'>>;
type Options = { platform?: NodeJS.Platform; home?: string; env?: Environment };

/** Private application data, separate from user-editable practice workspaces. */
export function platformDataDir(platform: NodeJS.Platform, home: string, env: Environment): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA && win32.isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : win32.join(home, 'AppData', 'Local');
    return win32.join(base, 'Factoryze', 'engine');
  }
  if (platform === 'darwin') return posix.join(home, 'Library', 'Application Support', 'Factoryze', 'engine');
  const base = env.XDG_DATA_HOME && posix.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : posix.join(home, '.local', 'share');
  return posix.join(base, 'factoryze', 'engine');
}

/** Resolve the native private-data location without changing the filesystem. */
export function factoryzeDataDir(options: Options = {}): string {
  const env = options.env ?? process.env;
  if (env.FACTORYZE_DATA_DIR) return env.FACTORYZE_DATA_DIR;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const legacy = (platform === 'win32' ? win32 : posix).join(home, '.factoryze');
  if (existsSync(legacy) && lstatSync(legacy).isSymbolicLink()) return legacy;
  return platformDataDir(platform, home, env);
}

/** One-time atomic move retains usage, imported packs, wheels and lab records. Never starts a blank store after a failed move. */
export function migrateFactoryzeDataDir(options: Options = {}): string {
  const env = options.env ?? process.env;
  if (env.FACTORYZE_DATA_DIR) return env.FACTORYZE_DATA_DIR;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const paths = platform === 'win32' ? win32 : posix;
  const target = platformDataDir(platform, home, env);
  const legacy = paths.join(home, '.factoryze');
  if (existsSync(target)) {
    if (!existsSync(legacy)) return target;
    // A previous launch may have created an empty native directory before migration.
    if (lstatSync(target).isDirectory() && readdirSync(target).length === 0) rmdirSync(target);
    else throw new Error(`Both Factoryze data directories exist: ${legacy} and ${target}. Set FACTORYZE_DATA_DIR to the one to use, or reconcile them before starting the app.`);
  }
  if (!existsSync(legacy)) return target;
  // A linked legacy directory is an intentional custom location; leave it in place.
  if (lstatSync(legacy).isSymbolicLink()) return legacy;
  if (!lstatSync(legacy).isDirectory()) throw new Error(`Factoryze data path is not a directory: ${legacy}`);
  mkdirSync(paths.dirname(target), { recursive: true, mode: 0o700 });
  try { renameSync(legacy, target); }
  catch (error) {
    throw new Error(`Could not move Factoryze data from ${legacy} to ${target}. Your existing data was not replaced.`, { cause: error });
  }
  return target;
}
