# Third-party notices for Factoryze desktop

Factoryze's own source is licensed under Apache 2.0 in `LICENSE`. The desktop app also includes third-party software and fonts under their own terms. Package names and versions below are taken from the locked dependency set; component copyrights and license terms remain those of their respective owners.

| Component | Version | Declared license | License and notice location in the installer |
| --- | --- | --- | --- |
| Eclipse Theia packages | 1.76.0 | EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0 | `licenses/theia/LICENSE-EPL`, `licenses/theia/NOTICE.md` |
| Monaco editor core | 1.108.201 | MIT | `app.asar/node_modules/@theia/monaco-editor-core/LICENSE` and `ThirdPartyNotices.txt` |
| Atkinson Hyperlegible Next and Mono | 5.3.0 | OFL-1.1 | License files in their `app.asar/node_modules/@fontsource/` packages |
| Electron | 42.8.1 | MIT; Chromium has additional notices | `licenses/electron/LICENSE`, `licenses/electron/LICENSES.chromium.html` |

The Theia license and notice files are copies from the [Eclipse Theia v1.76.0 repository](https://github.com/eclipse-theia/theia/tree/v1.76.0). The source and license files for most other installed npm dependencies are kept under `app.asar/node_modules/` or `app.asar.unpacked/node_modules/`; the exact dependency graph is locked in `pnpm-lock.yaml`. Review the packaged dependency inventory for each release because transitive dependencies can change.
