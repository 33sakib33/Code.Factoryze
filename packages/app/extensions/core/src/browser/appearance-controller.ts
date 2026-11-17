import { ThemeService } from '@theia/core/lib/browser/theming';
import type { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { type Appearance, appearanceKey, readAppearance, themeFor } from './appearance';

const COLOR_THEME = 'workbench.colorTheme';

/**
 * Applies the chosen appearance through Theia's own theme service, so the workbench, editor and terminal
 * change together. Factoryze's styles follow the `theia-dark` class that Theia puts on the body.
 */
export class AppearanceController {
  private readonly query = window.matchMedia('(prefers-color-scheme: dark)');
  constructor(private readonly themes: ThemeService, private readonly preferences: PreferenceService) {
    this.query.addEventListener('change', () => { if (this.mode === 'system') this.apply(); });
  }

  get mode(): Appearance { return readAppearance(window.localStorage); }

  /** Re-applies the saved mode, for example at startup. */
  apply(): void { this.themes.setCurrentTheme(themeFor(this.mode, this.query.matches), false); }

  async set(mode: Appearance): Promise<void> {
    try { window.localStorage.setItem(appearanceKey, mode); } catch { /* Storage blocked: applies for this session only. */ }
    // Keep Theia's own setting in step, so its preference validation never overrides the choice.
    await this.preferences.ready;
    await this.preferences.updateValue(COLOR_THEME, mode === 'system' ? undefined : mode);
    this.apply();
  }
}
