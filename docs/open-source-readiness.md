# Open-source publication review

## History and verification records — 2026-11-03

The owner chose to retain the existing Git history for the public repository. Its commit metadata includes contributor names and email addresses. Some captured verification logs contain local account paths, and older commits retain the LAN address redacted from the current narrative records. Anyone with the public repository can read those historical values. The original, hash-linked verification receipts are preserved rather than edited in place.

Before publication, a Gitleaks 8.30.1 scan of all local Git refs examined 50 commits and reported no known secret patterns. A separate review of tracked text found no real email address in file content; email addresses in test fixtures use reserved test domains. OCR of tracked screenshots found only `example.test` addresses. These checks reduce the risk of accidental disclosure but do not prove the absence of every private value.

If a specific historical value must later be removed, treat that as a separate history-rewrite decision: changing the current file does not remove it from existing commits or clones.

## Assessment material

Bundled practice packs and benchmark references remain public examples. Their hidden checks are hidden from the editable workspace during a run, but are readable in the source repository and installer. Controlled labs must use a separate private task collection through `server serve --tasks`; the default repository practice collection is suitable only for demonstrations and unverified practice.

## Collaboration and distribution

`CONTRIBUTING.md` documents setup, tests and sensitive-change review. `SECURITY.md` describes private reporting, and an Ubuntu pull-request workflow checks the deterministic test suite and typecheck. The existing three-OS installer workflows remain manual release checks.

The macOS desktop package now includes Factoryze's `LICENSE` and `NOTICE`, a third-party notice summary, the Eclipse Theia v1.76.0 EPL license and notice, and Electron/Chromium license files. The package verification command compares those resources with the source files. This is a packaging check, not a complete legal opinion or an all-platform release gate. Before distributing installers, review the full bundled dependency inventory and run the package verification and smoke checks on Windows and Linux as well as macOS.

Before changing repository visibility, enable GitHub private vulnerability reporting and confirm the retained commit identities and historical verification logs are acceptable to their contributors. No repository visibility or remote settings were changed during this review.
