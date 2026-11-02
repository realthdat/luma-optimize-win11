# Dependency audit — 2026-11-02

`npm audit --json` reports 29 findings: 1 critical, 13 high, 15 moderate. No dependency was added for Disk Cleanup. These existing findings remain unresolved in 0.2.0; this release is not a clean security audit.

| Area | Exposure and disposition |
|---|---|
| Electron 33 | Packaged runtime has high-severity advisories. Local UI and context isolation reduce some exposure but do not establish that advisories are unreachable. Upgrade requires a separate runtime migration and regression validation. |
| electron-builder 25 and transitive tar | Critical tar archive advisories and high build-tool findings affect the development/package toolchain. These npm packages are not included as runtime dependencies, but build-time archive processing remains relevant. Do not process untrusted build inputs. |
| Remaining build/dev dependencies | Moderate/high findings in the locked toolchain require individual upgrades and lockfile review. No forced bulk dependency upgrade was applied. |

Follow-up: upgrade Electron and the packaging toolchain, rerun audit and all regression checks, and review remaining advisories before wider distribution. Target review date: 2026-11-09. This document records outstanding work, not a claim of mitigation or an automated reminder.
