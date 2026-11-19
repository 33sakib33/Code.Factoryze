# Install the solo preview

This is an unreleased preview built from this checkout. It needs Python 3.11 or newer installed separately. See [the release checklist](docs/phase-1.md) for verified OS builds and remaining manual checks.

Status reconciled 2026-10-24: installed smoke receipts pass on Windows, Linux and macOS arm64. Windows/Linux real-provider workflows, downloaded-artifact Gatekeeper/SmartScreen/direct AppImage launch checks, and recorded human review remain open. Automated extraction/install smoke does not establish those manual results. No new installer was built for this documentation update.

Build the current platform's installer with `pnpm build:app` followed by `pnpm --filter @factoryze/app package:installer`. The artifact appears in `dist/`. Only run artifacts from a source you trust. Installers are unsigned; the macOS application has an ad-hoc signature, without Apple notarization.

For automated multi-platform builds and draft GitHub releases, see [Distributing desktop builds](docs/distribution.md).

## macOS

Open `Factoryze-<version>-arm64.dmg` on Apple silicon, drag Factoryze to Applications, then open it. If macOS blocks the downloaded app, review the source and use **System Settings → Privacy & Security → Open Anyway** for Factoryze. The arm64 artifact requires Apple silicon; build the x64 target on an Intel Mac for Intel hardware. The downloaded-app Gatekeeper flow still needs manual release verification.

## Windows

For source builds, follow [the development setup](README.md#develop-and-verify). Visual Studio 2022 Build Tools must include **Desktop development with C++** and the matching **MSVC v143 C++ x64/x86 Spectre-mitigated libs** (Individual components). Missing Spectre libraries cause `node-pty` to fail with `MSB8040`. `pnpm build:app` downloads the pinned Electron executable and builds the app.

Run the Factoryze `.exe` installer and follow its prompts. For an expected Microsoft Defender SmartScreen warning on this unsigned preview, review the source, then choose **More info → Run anyway** if you trust the artifact. Install Python 3.11+ with venv/pip and the `py` launcher enabled. The app checks `py` version selectors and Python executables; if `python` opens Microsoft Store, review Windows Settings → App execution aliases and install Python from python.org. The agent uses Windows PowerShell and runs `python -m unittest` directly; PowerShell 5.1 does not support Bash `&&`, `head` or `tail`. The integrated terminal currently defaults to Command Prompt, so copied shell commands may need different syntax; aligning its default with the agent remains an open decision. SmartScreen and real-provider operation remain manual release checks.

## Linux

Choose the package for your distribution: `.deb` for Debian/Ubuntu/Mint, `.rpm` for Fedora/RHEL/openSUSE, or `.AppImage` for a portable launch. The `v0.0.2` release has only an AppImage; Debian and RPM packages first appear in a later release once its Linux build and smoke checks pass. Install a downloaded Debian package with `sudo apt install ./factoryze_*.deb`, or a Fedora RPM with `sudo dnf install ./factoryze-*.rpm`. For other RPM distributions, use their native package manager. To use the AppImage, make it executable using file properties or `chmod +x /path/to/Factoryze.AppImage`, then launch it. AppImage runtime/FUSE support depends on your distribution; see the [AppImage FUSE guidance](https://docs.appimage.org/user-guide/troubleshooting/fuse.html) if it does not start.

Python must include both `venv` and `ensurepip`. The start sheet checks these before enabling Start. On Debian/Ubuntu, install the package matching the detected Python version, for example `sudo apt-get install python3.11-venv` for Python 3.11, then click Check again. Other distributions package this support differently.

Saved connections require an unlocked Secret Service in the current desktop session: GNOME Keyring, or KWallet with its Secret Service bridge. If unavailable, Factoryze shows recovery guidance rather than saving credentials in plaintext. You can instead launch with the existing backend environment configuration: `FACTORYZE_PROVIDER_URL`, `FACTORYZE_MODEL`, `FACTORYZE_PROVIDER_API_KEY`, and optionally `FACTORYZE_MODEL_API`. This bypasses the keychain and labels the connection as environment-managed in Settings. No real key is needed for the synthetic installer smoke.

## Start practice

1. Open **Factoryze**. It opens to **Home**. It never reopens your last task by itself; use **Continue** to go back to an attempt.
2. Under **Practice tasks**, click **Start**. The sheet checks Python and shows the attempt's token budget (click **Change** to set a different limit for this task). **Start attempt** copies the starter code, creates the Python environment and opens the editor with the starter file. To use your own task, click **Open task folder…** or **Open task ZIP…** on Home.
3. **Run tests** (title bar) runs the public tests in the Tests panel. Public tests may not cover every bug.
4. To use the agent, click **Connect a model** on Home or in Settings, choose where your model is, and enter the base URL, API key and model ID. If you start typing before connecting, Send opens Settings and keeps your draft. Review each proposed edit (shown as a diff) or command, then approve or reject it. **Stop** interrupts the agent.
5. When an attempt uses its budget, the agent pauses. **Raise budget** continues in practice, and the report records it.
6. **Submit** runs the hidden checks and opens the report. **Keep working** returns to the attempt; you can submit again. **Home** lists every submission under Results.

A quick local test without a provider key: start Library fines, click Run tests, then Submit. The buggy starter passes all five public tests but fails four of its nine hidden checks. In `library/returns.py`, use `clock.local_day(returned_at, branch)` instead of the UTC date (import it from `.clock`), then submit again; all nine hidden checks should pass. Monthly revenue report is the other bundled task, with two passing public tests and nine hidden checks.

Stable customer IDs and Pagination API are retired from the new-task list. Updating preserves their attempts, token totals and saved reports; use Continue or Results to return to them and submit again. In Continue, **Show all attempts** reveals older drafts beyond the three recent rows, including work never submitted.

For AI verification, connect a model, ask the agent to fix the task, review its edit, then submit. Click the budget meter for raw input, cached input and output. Input includes the agent's instructions, tool definitions, history and tool results, not only the text you typed. The deterministic developer check is `pnpm --filter @factoryze/app smoke:installer` after building the installer; it uses a synthetic provider and never your real key.

Optional sampling: in Settings, change the model connection and expand **Model limits and sampling**. **Temperature** accepts 0–2; blank keeps the provider default. Some models restrict the value. It applies to new agent sessions, so use **New session** after changing it. Reports show **Recorded agent settings** (harness, model, provider host, temperature and OS); earlier reports without this metadata stay readable. Paid model calls and benchmarks require explicit approval and an agreed spending limit.

For scoring, curated packages, incomplete usage recovery and verification commands, see [Phase 1 operation](docs/phase-1.md). Quit before replacing the app to update it; this preview has no automatic updater. Preserve your practice folders and Factoryze's private data (`~/Library/Application Support/Factoryze/engine` on macOS, `%LOCALAPPDATA%\Factoryze\engine` on Windows, or `$XDG_DATA_HOME/factoryze/engine` (or `~/.local/share/factoryze/engine` when unset) on Linux). An existing `~/.factoryze` directory moves there on first launch; keep it in backups until that launch succeeds.

## Local macOS development copies

Build outputs are not installed applications. After verifying a local build, `pnpm --filter @factoryze/app install:local:macos` installs it in Applications only if no Factoryze app already exists there. It preserves the obsolete settings/titlebar preview directories in `dist/.preview-archive.noindex`, unregisters their app copies and the current unpacked build from Launch Services, and registers the installed app. It never deletes practice folders, usage data or saved keys. If Factoryze is already installed, quit it and update using the DMG.

The smoke tests unregister their temporary macOS app copies during cleanup so they do not accumulate in app search. If search shows an old result briefly, reopen search after indexing catches up and launch `/Applications/Factoryze.app` directly.

OpenRouter accepts base URL `https://openrouter.ai/api/v1` or the full `/chat/completions` endpoint; Factoryze normalizes it before sending. A valid model ID can still fail because no provider matches the account/key routing or data policy. Known OpenRouter routing/data-policy/account errors receive specific guidance. Review the reported category rather than repeatedly changing the URL suffix; no account privacy setting is changed automatically.
