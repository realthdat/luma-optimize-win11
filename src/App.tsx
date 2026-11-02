import { useCallback, useEffect, useRef, useState } from 'react'
import { apps, dailyIds, findApp, findTweak, gamingExtraIds, tweaks, type Tweak } from './catalog'
import { useI18n, type Key } from './i18n'
import { CleanupPage, useCleanup, type CleanupState } from './CleanupPage'
import { formatBytes } from './cleanup-types'
import { PreviewDialog, ResultPanel, StartupPanel, type TaskReport } from './features'
import type { ApplyResult, Change, OpResult, Scan } from './types'

type View = 'cleanup' | 'home' | 'startup' | 'suggest' | 'apps' | 'except' | 'log'
type TaskKind = 'apply' | 'revert' | 'startupOn' | 'startupOff' | 'addFolder' | 'removeFolder' | 'preference'
type ActiveTask = { kind: TaskKind; target?: string; ids?: string[]; folder?: string }
type Note = { key?: Key; text?: string; vars?: Record<string, string | number> }

const nav: { id: View; label: Key }[] = [
  { id: 'home', label: 'nav.home' },
  { id: 'cleanup', label: 'nav.cleanup' },
  { id: 'startup', label: 'nav.startup' },
  { id: 'suggest', label: 'nav.suggest' },
  { id: 'apps', label: 'nav.apps' },
  { id: 'except', label: 'nav.except' },
  { id: 'log', label: 'nav.log' },
]

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    home: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    cleanup: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
    startup: 'M12 3v9 M6.3 5.7a9 9 0 1 0 11.4 0',
    suggest: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
    apps: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
    except: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z M9 12l2 2 4-4',
    log: 'M3 11a9 9 0 1 1 2.5 7 M3 4v7h7 M12 7v5l3 2',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    play: 'm9 5 11 7-11 7z',
    check: 'm5 12 4 4L19 6',
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.suggest} /></svg>
}

const groups = ['feel', 'power', 'service', 'play'] as const

function planned(scan: Scan, extra: string[]) {
  const tweaksToApply = [...dailyIds, ...extra].filter((id) => {
    const state = scan.tweaks[id]
    return state?.available && !state.applied
  })
  const startup = scan.startup
    .filter((item) => item.enabled && !item.protected && !scan.keptStartup?.includes(item.id) && (item.impact === 'high' || item.impact === 'mid'))
    .map((item) => item.id)
  return [...tweaksToApply, ...startup]
}

function changeLabel(change: Change, t: (key: Key) => string) {
  if (findTweak(change.id) || findApp(change.id)) return t(`${change.id}.title` as Key)
  return change.label
}

export function App() {
  const { t, lang, setLang } = useI18n()
  const vi = lang === 'vi'
  const cleanup = useCleanup()
  const [view, setView] = useState<View>('home')
  const [scan, setScan] = useState<Scan | null>(null)
  const [changes, setChanges] = useState<Change[]>([])
  const [task, setTask] = useState<ActiveTask | null>(null)
  const taskLock = useRef(false)
  const [scanning, setScanning] = useState(true)
  const busy = task !== null
  const [note, setNote] = useState<Note>({ key: 'note.reading' })
  const bootLang = useRef(lang)
  const [preview, setPreview] = useState<string[] | null>(null)
  const [report, setReport] = useState<TaskReport | null>(null)
  const activeTask = useRef<ActiveTask | null>(null)

  const refresh = useCallback(async () => {
    setScanning(true)
    try {
      const next = await window.muot.scan()
      setScan(next)
      setChanges(next.changes)
      if (!next.ok) setNote(next.message ? { text: next.message } : { key: 'note.scanFail' })
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const failed: Scan = {
        ok: false,
        message,
        startup: [],
        tweaks: {},
        apps: [],
        update: { disabled: false, revived: false },
        exclusions: [],
        hasBattery: false,
        changes: [],
      }
      setScan(failed)
      setNote(message ? { text: message } : { key: 'note.scanFail' })
      return failed
    } finally {
      setScanning(false)
    }
  }, [])

  useEffect(() => {
    void window.muot.setLang(bootLang.current).catch(() => undefined).then(() => refresh()).then((next) => {
      if (next.ok) setNote({})
    })
  }, [refresh])

  async function settle(result: ApplyResult, again?: (skip: boolean) => Promise<ApplyResult>) {
    let current = result
    if (current.needsConfirm && again) {
      const yes = window.confirm(t('confirm.restore', { message: current.message ?? '' }))
      if (!yes) {
        setNote({ key: 'note.cancelled' })
        return
      }
      current = await again(true)
    }
    const active = activeTask.current
    if (active) {
      const fallbackIds = active.ids?.length ? active.ids : [active.folder || active.target || active.kind]
      const results: OpResult[] = current.results?.length ? current.results : fallbackIds.map(id => ({ id, ok: current.ok, message: current.message, reboot: current.reboot }))
      setReport({ kind: active.kind, folder: active.folder, results: results.map(result => ({ ...result, label: result.label || targetLabel([result.id]) || active.target || result.id })), message: current.message })
    }
    setChanges(current.changes)
    if (!current.ok) setNote({ text: current.message || t('note.failed') })
    else if (current.reboot) setNote({ key: 'note.reboot' })
    else setNote(current.message ? { text: current.message } : { key: 'note.done' })
    await refresh()
  }

  async function runTask(active: ActiveTask, work: () => Promise<void>) {
    if (taskLock.current || cleanup.phase !== 'idle' || scanning) return
    taskLock.current = true
    activeTask.current = active
    setTask(active)
    setNote({ key: 'note.working' })
    try {
      await work()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('note.failed')
      setNote({ text: message })
      if (active.kind !== 'preference') setReport({ kind: active.kind, folder: active.folder, message, results: (active.ids?.length ? active.ids : [active.folder || active.kind]).map(id => ({ id, ok: false, label: targetLabel([id]) || active.target || id, message })) })
    } finally {
      taskLock.current = false
      setTask(null)
      activeTask.current = null
    }
  }

  function targetLabel(ids: string[]) {
    if (ids.length !== 1) return vi ? `${ids.length} thay đổi` : `${ids.length} changes`
    const id = ids[0]
    if (findTweak(id) || findApp(id)) return t(`${id}.title` as Key)
    return scan?.startup.find(item => item.id === id)?.name || changes.find(item => item.id === id)?.label
  }

  function applyIds(ids: string[]) {
    if (!taskLock.current && cleanup.phase === 'idle' && !scanning && ids.length) setPreview([...new Set(ids)])
  }

  async function executeApply(ids: string[]) {
    if (!ids.length) return
    await runTask({ kind: 'apply', target: targetLabel(ids), ids }, async () => {
      await settle(await window.muot.apply(ids), skip => window.muot.apply(ids, skip))
    })
  }

  async function revertIds(ids: string[]) {
    if (!ids.length) return
    await runTask({ kind: 'revert', target: targetLabel(ids), ids }, async () => {
      await settle(await window.muot.revert(ids), skip => window.muot.revert(ids, skip))
    })
  }

  async function toggleStartup(id: string, enabled: boolean) {
    await runTask({ kind: enabled ? 'startupOn' : 'startupOff', target: scan?.startup.find(item => item.id === id)?.name, ids: [id] }, async () => {
      await settle(await window.muot.setStartup(id, enabled), skip => window.muot.setStartup(id, enabled, skip))
    })
  }

  async function addFolder() {
    await runTask({ kind: 'addFolder' }, async () => {
      const folder = await window.muot.pickFolder()
      if (!folder || !window.confirm(t('except.folderConfirm', { path: folder }))) {
        setNote({ key: 'note.cancelled' })
        return
      }
      activeTask.current = { kind: 'addFolder', target: folder, folder }
      setTask(activeTask.current)
      await settle(await window.muot.addExclusion(folder), skip => window.muot.addExclusion(folder, skip))
    })
  }

  async function removeFolder(folder: string) {
    await runTask({ kind: 'removeFolder', target: folder, folder }, async () => {
      await settle(await window.muot.removeExclusion(folder), skip => window.muot.removeExclusion(folder, skip))
    })
  }

  async function keepStartup(id: string, kept: boolean) {
    await runTask({ kind: 'preference' }, async () => {
      const keptStartup = await window.muot.setStartupKept(id, kept)
      setScan(previous => previous ? { ...previous, keptStartup } : previous)
      setNote({ key: 'note.done' })
    })
  }

  function retryFailed() {
    if (!report) return
    const ids = report.results.filter(result => !result.ok).map(result => result.id)
    if (!ids.length) return
    if (report.kind === 'apply') applyIds(ids)
    else if (report.kind === 'revert') void revertIds(ids)
    else if (report.kind === 'startupOn' || report.kind === 'startupOff') void toggleStartup(ids[0], report.kind === 'startupOn')
    else if (report.kind === 'removeFolder' && report.folder) void removeFolder(report.folder)
    else if (report.kind === 'addFolder') void addFolder()
  }

  const loading = busy || scanning || cleanup.phase !== 'idle'
  const taskTitles: Record<TaskKind, string> = vi ? {
    preference: 'Đang lưu lựa chọn', apply: 'Đang áp dụng thay đổi', revert: 'Đang hoàn tác',
    startupOn: 'Đang bật khởi động', startupOff: 'Đang tắt khởi động',
    addFolder: 'Đang thêm thư mục loại trừ', removeFolder: 'Đang gỡ thư mục loại trừ',
  } : {
    preference: 'Saving preference', apply: 'Applying changes', revert: 'Undoing changes',
    startupOn: 'Enabling startup', startupOff: 'Disabling startup',
    addFolder: 'Adding folder exclusion', removeFolder: 'Removing folder exclusion',
  }
  const loadingTitle = cleanup.phase === 'scan' ? (vi ? 'Đang quét file rác' : 'Scanning for junk') : cleanup.phase === 'clean' ? (vi ? 'Đang dọn file đã chọn' : 'Cleaning selected files') : task ? taskTitles[task.kind] : t('note.reading')

  const changed = new Set(changes.map((change) => change.id))
  const noteText = note.text ?? (note.key ? t(note.key, note.vars) : '')

  return (
    <div className={`app${loading ? ' is-working' : ''}`}>
      <nav>
        <div className="brand"><span className="brand-mark">l</span><span>Luma<span className="brand-caption">PC CARE, SIMPLIFIED.</span></span></div>
        <p className="nav-label">{vi ? 'KHÔNG GIAN LÀM VIỆC' : 'WORKSPACE'}</p>
        {nav.map((item) => (
          <button key={item.id} type="button" aria-current={view === item.id ? 'page' : undefined} onClick={() => setView(item.id)}>
            <Icon name={item.id} /><span>{t(item.label)}</span>{view === item.id && <span className="nav-dot" />}
          </button>
        ))}
        <div className="sidebar-bottom"><div className="device"><span className="device-icon"><Icon name="home" /></span><div>Windows 11<small>{vi ? 'Không gian của bạn' : 'Your personal space'}</small></div><span className="online-dot" /></div></div>
        <div className="langs" aria-label={vi ? 'Ngôn ngữ' : 'Language'}>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          <button type="button" aria-pressed={lang === 'vi'} onClick={() => setLang('vi')}>VI</button>
        </div>
      </nav>
      <main>
        <header className="topbar"><span>Luma <span className="breadcrumb">/</span> {t(nav.find(item => item.id === view)!.label)}</span><span className="connection">{loading ? <span className="spinner spinner-small" aria-hidden="true" /> : <span className={scan?.ok ? 'online-dot' : 'pending-dot'} />}{loading ? loadingTitle : !scan ? t('note.reading') : scan.ok ? (vi ? 'Đã kết nối máy này' : 'Connected to this PC') : t('note.scanFail')}</span>{loading && <div className="task-progress" aria-hidden="true"><span /></div>}</header>
        <div className="page-content" aria-busy={loading}>
        {report && view !== 'cleanup' && <ResultPanel report={report} busy={loading} onRetry={retryFailed} onClose={() => setReport(null)} />}
        {!scan && view !== 'cleanup' && <div className="scan-placeholder" aria-hidden="true"><span className="skeleton skeleton-title" /><span className="skeleton skeleton-copy" /><span className="skeleton skeleton-hero" /><div className="skeleton-stats"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div></div>}
        {scan && !scan.ok && view !== 'cleanup' && <button type="button" onClick={() => void refresh()} disabled={loading}>{t('retry')}</button>}
        {view === 'cleanup' && <CleanupPage state={cleanup} busy={loading} />}
        {scan?.ok && view === 'home' && <Home scan={scan} busy={loading} cleanup={cleanup} onApply={applyIds} onNavigate={setView} onScan={() => { setView('cleanup'); void cleanup.rescan() }} />}
        {scan?.ok && view === 'startup' && <StartupPanel scan={scan} busy={loading} onToggle={toggleStartup} onKeep={keepStartup} onRefresh={() => void refresh()} />}
        {scan?.ok && view === 'suggest' && <Suggest scan={scan} changed={changed} busy={loading} onApply={applyIds} onRevert={revertIds} />}
        {scan?.ok && view === 'apps' && <Apps scan={scan} changed={changed} busy={loading} onApply={applyIds} onRevert={revertIds} />}
        {scan?.ok && view === 'except' && (
          <Except scan={scan} busy={loading} onApply={applyIds} onRevert={revertIds} onAdd={addFolder} onRemove={removeFolder} />
        )}
        {scan?.ok && view === 'log' && <Log changes={changes} busy={loading} onRevert={revertIds} />}
        </div>
      </main>
      {preview && scan && <PreviewDialog ids={preview} scan={scan} busy={loading} onClose={() => setPreview(null)} onApply={ids => { setPreview(null); void executeApply(ids) }} />}
      {loading && <aside className="task-toast" role="status" aria-live="polite" aria-atomic="true"><span className="task-spinner-wrap"><span className="spinner" aria-hidden="true" /></span><div><strong>{loadingTitle}<span className="loading-dots" aria-hidden="true">…</span></strong>{task?.target && <p className="task-target" title={task.target}>{task.target}</p>}<p>{scanning && task ? (vi ? 'Đang cập nhật trạng thái máy.' : 'Refreshing your PC’s status.') : (vi ? 'Bạn vẫn có thể xem các trang trong lúc chờ.' : 'You can keep browsing while you wait.')}</p></div></aside>}
      <footer className="undo">
        <span role="status" aria-live="polite">{t('undo.count', { n: changes.length })}{noteText ? ` · ${noteText}` : ''}</span>
        <button type="button" className="quiet" disabled={loading || changes.length === 0} onClick={() => void revertIds(changes.map((change) => change.id))}>
          {vi ? 'Hoàn tác cấu hình' : 'Undo settings'}
        </button>
      </footer>
    </div>
  )
}

function Home({ scan, busy, cleanup, onApply, onNavigate, onScan }: { scan: Scan; busy: boolean; cleanup: CleanupState; onApply: (ids: string[]) => void; onNavigate: (view: View) => void; onScan: () => void }) {
  const { t, lang } = useI18n()
  const vi = lang === 'vi'
  const daily = planned(scan, []), gaming = planned(scan, gamingExtraIds)
  const enabled = scan.startup.filter(item => item.enabled).length
  const disk = cleanup.disk
  const reclaimable = cleanup.scan?.groups.reduce((sum, group) => sum + group.bytes, 0)
  const usedPercent = disk && disk.total > 0 ? Math.max(0, Math.min(100, (disk.total - disk.free) / disk.total * 100)) : 0
  return <>
    <div className="workspace-title"><div><p className="eyebrow">{vi ? 'KHÔNG GIAN CỦA BẠN, THEO CÁCH CỦA BẠN' : 'YOUR PC. YOUR WAY.'}</p><h1>{vi ? 'Máy gọn hơn. Việc nhẹ hơn.' : 'A lighter PC. A clearer day.'}</h1><p className="lead">{vi ? 'Dọn dẹp, tinh chỉnh và kiểm soát máy tính Windows của bạn.' : 'Clean up, fine-tune and stay in control of Windows.'}</p></div><button disabled={busy} onClick={onScan}><Icon name="cleanup" size={17} />{vi ? 'Quét file rác' : 'Scan for junk'}</button></div>
    <div className="overview-metrics"><div><span className="metric-icon"><Icon name="home" /></span><div><span>{vi ? 'Dung lượng trống' : 'Free disk space'}</span><strong>{disk ? formatBytes(disk.free) : '—'}</strong></div></div><button onClick={() => onNavigate('cleanup')}><span className="metric-icon"><Icon name="cleanup" /></span><div><span>{vi ? 'File có thể dọn' : 'Eligible for cleanup'}</span><strong>{reclaimable === undefined ? (vi ? 'Chưa quét' : 'Not scanned') : formatBytes(reclaimable)}</strong></div></button><button onClick={() => onNavigate('startup')}><span className="metric-icon"><Icon name="startup" /></span><div><span>{vi ? 'Ứng dụng khởi động' : 'Startup apps enabled'}</span><strong>{enabled}</strong></div></button></div>
    <div className="overview-grid"><div className="overview-main"><section className="surface"><div className="surface-heading"><h2>{vi ? 'Dung lượng ổ đĩa' : 'Disk storage'} {disk?.drive}</h2><span>{disk ? `${formatBytes(disk.free)} / ${formatBytes(disk.total)}` : (vi ? 'Chưa đọc được dung lượng' : 'Storage unavailable')}</span></div><div className="storage-bar" role="img" aria-label={disk ? `${usedPercent.toFixed(0)}% ${vi ? 'đã dùng' : 'used'}` : (vi ? 'Chưa có dữ liệu' : 'No data')}><span style={{ width: `${usedPercent}%` }} /></div><div className="storage-legend"><span><i />{vi ? 'Đã dùng' : 'Used'} {disk ? formatBytes(disk.total - disk.free) : '—'}</span><span><i />{vi ? 'Còn trống' : 'Free'} {disk ? formatBytes(disk.free) : '—'}</span></div></section>
    <section className="surface action-list"><h2>{vi ? 'Việc nên làm' : 'Make room for your day'}</h2>{([{ view: 'cleanup', icon: 'cleanup', title: vi ? 'Dọn file tạm' : 'Clean temporary files', detail: vi ? 'Xem trước và giải phóng dung lượng ổ đĩa.' : 'Review old files and reclaim disk space.' }, { view: 'startup', icon: 'startup', title: vi ? 'Xem ứng dụng khởi động' : 'Review startup apps', detail: vi ? 'Quyết định ứng dụng nào chạy cùng Windows.' : 'Choose what launches with Windows.' }, { view: 'suggest', icon: 'suggest', title: vi ? 'Xem trước tinh chỉnh' : 'Review adjustments', detail: vi ? 'Chọn các thay đổi phù hợp với cách bạn sử dụng.' : 'Choose changes that fit your workflow.' }] as const).map(item => <button key={item.view} onClick={() => onNavigate(item.view)}><span className="metric-icon"><Icon name={item.icon} /></span><div><strong>{item.title}</strong><span>{item.detail}</span></div><Icon name="arrow" size={17} /></button>)}</section></div>
    <div className="overview-profiles profiles">{[{ title: vi ? 'Hằng ngày' : 'Everyday', icon: 'suggest', ids: daily, detail: vi ? 'Giảm gợi ý và ứng dụng chạy cùng Windows.' : 'Reduce suggestions and startup apps.' }, { title: vi ? 'Chơi game' : 'Gaming', icon: 'play', ids: gaming, detail: vi ? 'Thêm Game Mode và tinh chỉnh đồ họa.' : 'Add Game Mode and graphics adjustments.' }].map(profile => <article className="surface profile" key={profile.title}><span className="profile-icon"><Icon name={profile.icon} size={23} /></span><h3>{profile.title}</h3><p>{profile.detail}</p><button disabled={busy || profile.ids.length === 0} onClick={() => onApply(profile.ids)}>{profile.ids.length ? (vi ? `Xem trước (${profile.ids.length})` : `Review (${profile.ids.length})`) : (vi ? 'Đã thiết lập' : 'All set')}<Icon name="arrow" size={16} /></button></article>)}</div></div>
    <section className="surface recent-activity"><div className="surface-heading"><h2>{vi ? 'Hoạt động gần đây' : 'Recent activity'}</h2><button className="quiet" onClick={() => onNavigate('log')}>{vi ? 'Xem lịch sử cấu hình' : 'View settings history'} →</button></div>{cleanup.result && <div className="activity-row"><span>{new Date(cleanup.result.at).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')}</span><strong>{vi ? 'Dọn file rác' : 'Disk cleanup'}</strong><span>{formatBytes(cleanup.result.bytes)} · {cleanup.result.deleted} file</span></div>}{[...scan.changes].reverse().slice(0, 3).map(change => <div className="activity-row" key={change.id}><span>{new Date(change.at).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US')}</span><strong>{changeLabel(change, t)}</strong><span>{vi ? 'Có thể hoàn tác' : 'Undo available'}</span></div>)}{!cleanup.result && scan.changes.length === 0 && <p className="activity-empty">{vi ? 'Chưa có thay đổi. Bắt đầu bằng một lần quét.' : 'No changes yet. Start with a scan.'}</p>}</section>
  </>
}


function Suggest({ scan, changed, busy, onApply, onRevert }: RowProps) {
  const { t } = useI18n()
  return (
    <>
      <h1>{t('suggest.title')}</h1>
      <p className="lead">{t('suggest.lead')}</p>
      {groups.map((group) => {
        const rows = tweaks.filter((tweak) => tweak.group === group && scan.tweaks[tweak.id]?.available !== false)
        if (!rows.length) return null
        return (
          <section key={group}>
            <h2 className="group">{t(`group.${group}`)}</h2>
            {rows.map((tweak) => (
              <TweakRow key={tweak.id} tweak={tweak} scan={scan} changed={changed} busy={busy} onApply={onApply} onRevert={onRevert} />
            ))}
          </section>
        )
      })}
    </>
  )
}

function TweakRow({ tweak, scan, changed, busy, onApply, onRevert }: RowProps & { tweak: Tweak }) {
  const { t } = useI18n()
  const state = scan.tweaks[tweak.id]
  const applied = state?.applied === true
  return (
    <div className="row">
      <div>
        <h2>{t(`${tweak.id}.title` as Key)}</h2>
        <p>{t(`${tweak.id}.detail` as Key)}</p>
      </div>
      <span className={tweak.risk === 'risk' ? 'risk hot' : 'risk'}>{t(`risk.${tweak.risk}`)}</span>
      {!applied && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (tweak.confirm && !window.confirm(t(`${tweak.id}.confirm` as Key))) return
            onApply([tweak.id])
          }}
        >
          {t(`${tweak.id}.apply` as Key)}
        </button>
      )}
      {applied && changed.has(tweak.id) && <button type="button" className="quiet" disabled={busy} onClick={() => onRevert([tweak.id])}>{t('undo.button')}</button>}
      {applied && !changed.has(tweak.id) && <span className="state">{t('state.applied')}</span>}
    </div>
  )
}

function Apps({ scan, changed, busy, onApply, onRevert }: RowProps) {
  const { t } = useI18n()
  return (
    <>
      <h1>{t('apps.title')}</h1>
      <p className="lead">{t('apps.lead')}</p>
      {apps.map((app) => {
        const installed = scan.apps.find((row) => row.id === app.id)?.installed === true
        const name = t(`${app.id}.title` as Key)
        return (
          <div className="row" key={app.id}>
            <div>
              <h2>{name}</h2>
              <p>{t(`${app.id}.detail` as Key)}</p>
            </div>
            <span className="risk">{t('risk.choice')}</span>
            {installed && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('apps.confirm', { name }))) onApply([app.id])
                }}
              >
                {t('apps.remove')}
              </button>
            )}
            {!installed && changed.has(app.id) && <button type="button" className="quiet" disabled={busy} onClick={() => onRevert([app.id])}>{t('apps.reinstall')}</button>}
            {!installed && !changed.has(app.id) && <span className="state">{t('apps.absent')}</span>}
          </div>
        )
      })}
    </>
  )
}

function Except({ scan, busy, onApply, onRevert, onAdd, onRemove }: {
  scan: Scan
  busy: boolean
  onApply: (ids: string[]) => void
  onRevert: (ids: string[]) => void
  onAdd: () => void
  onRemove: (folder: string) => void
}) {
  const { t, lang } = useI18n()
  const vi = lang === 'vi'
  const off = scan.update.disabled && !scan.update.revived
  const exclusionText = scan.exclusionError === 'exclusion-unreadable' ? t('error.exclusions') : scan.exclusionError
  return (
    <>
      <p className="eyebrow">{vi ? 'TÙY CHỈNH NÂNG CAO' : 'ADVANCED CONTROLS'}</p>
      <h1>{t('except.title')}</h1>
      <p className="lead">{vi ? 'Quản lý cập nhật và phạm vi quét theo nhu cầu của bạn.' : 'Manage updates and scanning boundaries for your workflow.'}</p>
      <div className="exception-notice"><Icon name="except" size={22} /><div><strong>{vi ? 'Thay đổi có ảnh hưởng đến bảo vệ máy' : 'Changes that affect PC protection'}</strong><p>{t('except.lead')}</p></div><span className="risk hot">{t('risk.risk')}</span></div>
      <section className="exception-card">
        <div className="exception-heading"><span className="profile-icon"><Icon name="log" size={23} /></span><div><h2>Windows Update</h2><p>{vi ? 'Cập nhật hệ thống & bản vá bảo mật' : 'System updates & security patches'}</p></div><span className={`status-pill ${off ? 'status-warn' : ''}`}><span />{off ? (vi ? 'Đang tắt' : 'Disabled') : (vi ? 'Đang bật' : 'Enabled')}</span></div>
        <p className="exception-description">{t('windows-update.detail')}</p>
        {scan.update.revived && <p className="inline-notice">{t('except.revived')}</p>}
        <div className="exception-controls"><span>{vi ? 'Áp dụng cho máy này' : 'Applies to this PC'}</span><span className="risk hot">{t('risk.risk')}</span><button type="button" className={off ? '' : 'quiet'} disabled={busy} onClick={() => { if (off) onRevert(['windows-update']); else if (window.confirm(t('windows-update.confirm'))) onApply(['windows-update']) }}>{off ? (vi ? 'Bật cập nhật' : 'Turn on updates') : (vi ? 'Tắt cập nhật' : 'Turn off updates')}</button></div>
      </section>
      <section className="exception-card">
        <div className="exception-heading"><span className="profile-icon"><Icon name="except" size={23} /></span><div><h2>{t('except.folders')}</h2><p>Microsoft Defender</p></div><span className="folder-count">{exclusionText ? '—' : scan.exclusions.length} {vi ? 'thư mục' : 'folders'}</span></div>
        <p className="exception-description">{t('except.folderLead')}</p>
        <div className="folder-toolbar"><h3>{vi ? 'Danh sách loại trừ' : 'Excluded folders'}</h3><button type="button" disabled={busy} onClick={onAdd}><span aria-hidden="true">+</span>{t('except.pick')}</button></div>
        {exclusionText && <p className="inline-notice" role="alert">{exclusionText}</p>}
        {!exclusionText && scan.exclusions.length === 0 && <div className="empty-panel"><Icon name="except" size={30} /><strong>{vi ? 'Chưa có thư mục loại trừ' : 'No excluded folders'}</strong><p>{vi ? 'Thêm thư mục khi bạn cần bỏ qua việc quét tại vị trí đó.' : 'Add a folder when you need to skip scanning that location.'}</p></div>}
        {scan.exclusions.map(folder => <div className="row folder-row" key={folder}><div className="mono" title={folder}>{folder}</div><span className="risk hot">{t('risk.risk')}</span><button type="button" className="quiet" disabled={busy} onClick={() => onRemove(folder)}>{t('except.remove')}</button></div>)}
      </section>
    </>
  )
}

function Log({ changes, busy, onRevert }: { changes: Change[]; busy: boolean; onRevert: (ids: string[]) => void }) {
  const { t, lang } = useI18n()
  const rows = [...changes].reverse()
  return (
    <>
      <h1>{t('log.title')}</h1>
      {rows.length === 0 && <p className="lead">{t('log.empty')}</p>}
      {rows.map((change) => (
        <div className="row" key={change.id}>
          <div>
            <h2>{changeLabel(change, t)}</h2>
            <p className="mono">{new Date(change.at).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')}</p>
          </div>
          <span />
          <button type="button" className="quiet" disabled={busy} onClick={() => onRevert([change.id])}>{t('undo.button')}</button>
        </div>
      ))}
    </>
  )
}

type RowProps = {
  scan: Scan
  changed: Set<string>
  busy: boolean
  onApply: (ids: string[]) => void
  onRevert: (ids: string[]) => void
}
