/**
 * The engine's ledger never stores prompt text. The student's own prompts are kept in this window's local storage,
 * keyed by the engine's prompt ID, so the report can show what was asked next to what it cost.
 */
const key = (promptId: string): string => `factoryze:prompt:${promptId}`;
const LIMIT = 2000;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const store = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };

export function rememberPrompt(promptId: string, text: string, storage: Storage | undefined = store()): void {
  try { storage?.setItem(key(promptId), text.length > LIMIT ? `${text.slice(0, LIMIT - 1)}…` : text); } catch { /* Storage full or disabled: the report falls back to "Prompt N". */ }
}
export function promptText(promptId: string, storage: Storage | undefined = store()): string | undefined {
  try { return storage?.getItem(key(promptId)) ?? undefined; } catch { return undefined; }
}
