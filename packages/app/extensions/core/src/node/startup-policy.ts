/**
 * Factoryze always opens to Home. A workspace given on the command line still opens directly,
 * but the most recently used attempt is never restored on launch. Students continue it from Home.
 */
export function startupWorkspace(fromCommandLine: string | undefined, _mostRecent?: string): string | undefined {
  return fromCommandLine || undefined;
}
