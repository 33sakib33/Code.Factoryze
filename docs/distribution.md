# Distributing desktop builds

The `Build release installers` GitHub Actions workflow packages the desktop app for macOS, Windows and Linux whenever a `v*` tag is pushed. It runs the test suite and typecheck, builds and smoke-tests the platform installer, then attaches the installers and SHA-256 checksums to a **draft GitHub Release**. A maintainer reviews and publishes the draft manually.

## Prepare a release

1. Review the package and smoke results in [Phase 1](phase-1.md#release-evidence), and record any manual checks still open. Public early previews are not classroom-ready releases.
2. Set `packages/app/package.json` to the intended desktop version. The tag must match it exactly, with a `v` prefix. For example, package version `0.1.0` requires tag `v0.1.0`.
3. Merge the approved source to the branch intended for release.
4. Create and push the matching tag:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

5. Wait for **Build release installers** to pass on all three platform runners. Review the draft release, installer names and checksums, then publish it when approved.

The workflow uses the repository's existing unsigned installer configuration. macOS builds are ad-hoc signed and not notarized; Windows installers are unsigned; Linux outputs are AppImage, Debian and RPM packages. The workflow extracts and smoke-tests each Linux format under Ubuntu; a native Fedora/RHEL/openSUSE install and a direct AppImage launch still require separate manual verification. Recipients can see platform security warnings. Signing and notarization credentials are not configured. The macOS artifact targets the architecture of the hosted runner.

Each push to `main` runs **Unsigned installers** for macOS, Windows and Linux. The resulting installer candidates are private GitHub Actions artifacts retained for 14 days; they do not create public download links. For a one-off build, use **Actions → Unsigned installers → Run workflow** and select the platforms to build. A public link requires a reviewed release published from a public distribution location.
