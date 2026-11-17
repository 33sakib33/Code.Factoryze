import { BrowserWindow } from 'electron';
import { ContainerModule, injectable } from '@theia/core/shared/inversify';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { TheiaRendererAPI } from '@theia/core/lib/electron-main/electron-api-main';

/** Updates the splash from real startup milestones; the bar never estimates elapsed time. */
@injectable()
class FactoryzeElectronMainApplication extends ElectronMainApplication {
  protected override async configureAndShowSplashScreen(mainWindow: BrowserWindow): Promise<BrowserWindow> {
    const splash = await super.configureAndShowSplashScreen(mainWindow);
    let loaded = false, progress = 0, label = 'Starting Factoryze';
    const paint = () => {
      if (!loaded || splash.isDestroyed() || splash.webContents.isDestroyed()) return;
      const script = `(() => {
        document.getElementById('fz-splash-fill')?.setAttribute('width', String(${progress * 362 / 100}));
        const status = document.getElementById('fz-splash-status');
        if (status) status.textContent = ${JSON.stringify(label)};
      })()`;
      void splash.webContents.executeJavaScript(script).catch(() => undefined);
    };
    const advance = (next: number, message: string) => {
      if (next <= progress) return;
      progress = next; label = message; paint();
    };
    splash.webContents.on('did-finish-load', () => { loaded = true; advance(10, 'Starting Factoryze'); paint(); });
    if (!splash.webContents.isLoading()) { loaded = true; advance(10, 'Starting Factoryze'); paint(); }
    void this.backendPort.then(() => advance(50, 'Local services ready')).catch(() => undefined);
    mainWindow.webContents.on('did-finish-load', () => advance(80, 'Opening your workspace'));
    TheiaRendererAPI.onApplicationStateChanged(mainWindow.webContents, state => {
      if (state === 'ready') advance(100, 'Ready');
    });
    return splash;
  }
}

export default new ContainerModule((_bind, _unbind, _isBound, rebind) => {
  rebind(ElectronMainApplication).to(FactoryzeElectronMainApplication).inSingletonScope();
});
