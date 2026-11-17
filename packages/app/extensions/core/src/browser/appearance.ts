/** Appearance is a per-computer preference: follow the system, or force light or dark. */
export type Appearance = 'system' | 'light' | 'dark';
export const appearanceKey = 'factoryze:appearance';
const modes: readonly Appearance[] = ['system', 'light', 'dark'];

export function readAppearance(storage: Pick<Storage, 'getItem'> | undefined): Appearance {
  try {
    const value = storage?.getItem(appearanceKey);
    return modes.includes(value as Appearance) ? value as Appearance : 'system';
  } catch { return 'system'; }
}

/** The built-in Theia theme to use. Theia's dark and light themes also switch the editor and terminal. */
export function themeFor(mode: Appearance, prefersDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}
