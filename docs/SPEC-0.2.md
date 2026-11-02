# Luma 0.2 — approved implementation

Approved by the user: UI mockup, Disk Cleanup feature, build release, then push source to the supplied GitHub repository.

## Scope and order
1. Typed cleanup service and filesystem fixture tests.
2. IPC: fixed account-local roots; scan token and group IDs only; native confirmation before delete.
3. Approved forest sidebar and compact overview; live storage data; cleanup selection, preview, results.
4. Regression checks, Electron rendering, installer build, source push.

## Contracts
- Scan is read-only. Roots: LOCALAPPDATA/Temp and LOCALAPPDATA/Microsoft/Windows/WER/ReportArchive.
- Files older than seven days only. Skip links, hard links, project folders, inaccessible paths and changed files.
- An in-memory scan token expires in 15 minutes, is invalidated by a new scan and consumed by cleanup. Never accept paths from renderer.
- Never recursively delete directories. Before each unlink verify canonical root containment, all ancestor links, file identity/size/timestamps and age again.
- Locked files are skipped. Partial scans and partial cleanup are visible, not reported as complete success.
- Confirmation defaults to Cancel. No Undo promise for files. Downloads/Documents/Desktop are outside the allowlist.
- Native tools: fixed Windows Disk Cleanup executable and fixed Recycle Bin explorer argument; no user supplied shell commands.
- Frontend preserves selection and scan state when navigating; loading never dims content.

## Verification
`npm test`, `npm run typecheck`, `npm run check`, `npm run build`.
Filesystem tests use exclusively dedicated fixture folders under the workspace. UI tests use isolated Electron windows and mocked machine data. No actual user files are deleted during verification.

## Limits
Scan budgets: 50,000 entries / 60 seconds. Results are logical file sizes, not a claim about physical disk allocation. Windows files in use may fail deletion and are reported. Path checks are repeated immediately before unlink; not intended as a privileged service against a malicious local process changing the filesystem concurrently.

## Layout
Reference: design/luma-v2/prototype.png. Forest sidebar, warm white content, mint selection; fixed action columns. Overview has real disk capacity/free space, cleanup scan count (unknown before scanning), startup count, activity and profile shortcuts. Disk Cleanup has category table and selection summary.
