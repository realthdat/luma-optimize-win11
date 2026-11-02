# Luma

A Windows 11 app for managing startup applications, adjusting system settings, and cleaning up junk files. The interface supports English and Vietnamese.

## Features

- Disk space overview with a forest-green sidebar interface.
- Startup application toggles, exception management, and change previews.
- Tuning profiles, activity history, configuration undo, and retries for failed tasks.
- Cleanup of temporary files and Windows error reports older than 7 days, with scanning, category selection, previews, confirmation, and results.
- Loading indicators while tasks are running.

Disk Cleanup only processes `%LOCALAPPDATA%\Temp` and `%LOCALAPPDATA%\Microsoft\Windows\WER\ReportArchive`. It skips recent or changed files, hard links, junctions/symbolic links, and recognized project folders. It does not clean Downloads or personal documents. Deleted files **cannot be undone**; undo applies only to configuration changes. Cleanup results are retained for the current session.

## Development on Windows

Requires Node.js 22+, npm, and Windows PowerShell.

```powershell
npm ci
npm run dev
```

Run checks and build the installer:

```powershell
npm run typecheck
npm test
npm run check
npm run test:ui
npm run release
```

The installer is generated in `release-luma/`. Cleanup tests only delete fixture files they create inside `.qa/`; UI tests use mock data. The installer is currently unsigned.

## Design and Limitations

- [Version 0.2 specification](docs/SPEC-0.2.md)
- [Approved mockup](design/luma-v2/prototype.png)
- [Changelog](CHANGELOG.md)
- [Dependency audit status](docs/DEPENDENCY-AUDIT.md)

Configuration data continues to use the `Trim` application directory to preserve existing history. Disk Cleanup does not request elevated privileges. Scans have time and entry limits; the interface indicates when results are incomplete. Path checks do not guarantee protection against a malicious local process modifying the filesystem concurrently.

## Copyright

Copyright © 2026 Dat Nguyen.
