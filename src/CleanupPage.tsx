import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from './i18n'
import { formatBytes, type CleanupGroupId, type CleanupResult, type CleanupScan, type DiskInfo } from './cleanup-types'

export function useCleanup() {
  const [scan, setScan] = useState<CleanupScan | null>(null)
  const [disk, setDisk] = useState<DiskInfo | null>(null)
  const [result, setResult] = useState<CleanupResult | null>(null)
  const [phase, setPhase] = useState<'idle' | 'scan' | 'clean'>('idle')
  const [error, setError] = useState('')
  const lock = useRef(false)
  const refreshDisk = useCallback(async () => { try { setDisk(await window.muot.storageInfo()) } catch { setDisk(null) } }, [])
  useEffect(() => { void refreshDisk() }, [refreshDisk])
  async function rescan() {
    if (lock.current) return
    lock.current = true; setPhase('scan'); setError(''); setScan(null); setResult(null)
    try { setScan(await window.muot.cleanupScan()); await refreshDisk() }
    catch (error) { setError(String(error)) }
    finally { lock.current = false; setPhase('idle') }
  }
  async function clean(ids: CleanupGroupId[]) {
    if (lock.current || !scan) return
    lock.current = true; setPhase('clean'); setError('')
    try {
      const next = await window.muot.cleanupRun(scan.token, ids)
      if (!next.cancelled) { setResult(next); setScan(null); await refreshDisk() }
    } catch (error) { setError(String(error)); setScan(null) }
    finally { lock.current = false; setPhase('idle') }
  }
  async function openTool(tool: 'disk' | 'recycle') {
    try { await window.muot.openCleanupTool(tool) } catch (error) { setError(String(error)) }
  }
  return { scan, disk, result, phase, error, rescan, clean, openTool }
}
export type CleanupState = ReturnType<typeof useCleanup>
export function CleanupPage({ state, busy }: { state: CleanupState; busy: boolean }) {
  const { lang } = useI18n(), vi = lang === 'vi'
  const [selected, setSelected] = useState<CleanupGroupId[]>(['temp', 'reports'])
  const [preview, setPreview] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => { if (preview) dialog.current?.showModal(); else dialog.current?.close() }, [preview])
  const groups = state.scan?.groups.filter(group => selected.includes(group.id) && !group.unavailable) ?? []
  const count = groups.reduce((sum, group) => sum + group.count, 0)
  const bytes = groups.reduce((sum, group) => sum + group.bytes, 0)
  const expired = !!state.scan && now > Date.parse(state.scan.expiresAt)
  const label = (id: CleanupGroupId) => id === 'temp' ? (vi ? 'File tạm trên 7 ngày' : 'Temporary files older than 7 days') : (vi ? 'Báo cáo lỗi cũ' : 'Old error reports')
  return <>
    <div className="workspace-title"><div><p className="eyebrow">{vi ? 'THÊM CHỖ CHO ĐIỀU QUAN TRỌNG' : 'SPACE FOR WHAT MATTERS'}</p><h1>{vi ? 'Dọn ổ đĩa' : 'Disk cleanup'}</h1><p className="lead">{vi ? 'Chọn những gì bạn muốn dọn. Bạn luôn quyết định trước khi xóa.' : 'Choose what to clean. You decide before anything is deleted.'}</p></div><button className="quiet" disabled={busy} onClick={() => void state.rescan()}>{state.scan || state.result ? (vi ? 'Quét lại' : 'Scan again') : (vi ? 'Quét file rác' : 'Scan for junk')}</button></div>
    <ol className="cleanup-steps" aria-label={vi ? 'Các bước dọn file' : 'Cleanup steps'}>{[vi ? 'Quét' : 'Scan', vi ? 'Chọn file' : 'Select files', vi ? 'Dọn dẹp' : 'Clean up'].map((text, index) => <li key={text} aria-current={(state.result || state.phase === 'clean' ? 2 : state.scan ? 1 : 0) === index ? 'step' : undefined}><span>{index + 1}</span>{text}</li>)}</ol>
    {state.error && <div className="inline-notice" role="alert">{state.error.includes('cleanup-expired') ? (vi ? 'Kết quả đã hết hạn. Hãy quét lại trước khi dọn.' : 'The scan expired. Scan again before cleaning.') : (vi ? 'Không hoàn tất được thao tác. Hãy thử quét lại.' : 'The operation could not finish. Try scanning again.')}<details><summary>{vi ? 'Chi tiết' : 'Details'}</summary>{state.error}</details></div>}
    {state.result && <section className="cleanup-result" role="status"><div className="result-symbol">✓</div><div><h2>{vi ? 'Đã xử lý xong' : 'Cleanup finished'}</h2><p><strong>{formatBytes(state.result.bytes)}</strong> · {state.result.deleted} {vi ? 'file đã xóa' : 'files deleted'}</p><p>{state.result.skipped} {vi ? 'bỏ qua' : 'skipped'} · {state.result.failed} {vi ? 'lỗi' : 'failed'}</p><small>{vi ? 'Dung lượng tính theo kích thước file đã xóa; dung lượng trống thực tế có thể khác.' : 'Based on deleted file sizes; actual free disk space may differ.'}</small></div>{state.result.issues.length > 0 && <details><summary>{vi ? 'Xem các mục chưa dọn được' : 'Review remaining items'}</summary>{state.result.issues.map((issue, i) => <p key={i} className="mono">{issue.path}<br />{issue.reason === 'changed' ? (vi ? 'Đã thay đổi hoặc không còn đủ điều kiện' : 'Changed or no longer eligible') : issue.reason}</p>)}<small>{vi ? 'Hiển thị tối đa 30 mục.' : 'Up to 30 items shown.'}</small></details>}</section>}
    <div className="cleanup-layout"><section className="surface cleanup-table"><div className="surface-heading"><h2>{vi ? 'Kết quả quét' : 'Scan results'}</h2><span>{state.scan ? new Date(state.scan.scannedAt).toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}</span></div>
      {state.phase === 'scan' ? <div className="cleanup-empty"><span className="spinner" /><h3>{vi ? 'Đang tìm file có thể dọn…' : 'Finding eligible files…'}</h3><p>{vi ? 'Chỉ đọc dữ liệu trong bước này.' : 'No files are deleted during scanning.'}</p></div> : !state.scan ? <div className="cleanup-empty"><div className="empty-disk">⌑</div><h3>{vi ? 'Bắt đầu bằng một lần quét' : 'Start with a scan'}</h3><p>{vi ? 'Tìm file tạm và báo cáo lỗi cũ trong tài khoản của bạn.' : 'Find old temporary files and error reports in your account.'}</p><button disabled={busy} onClick={() => void state.rescan()}>{vi ? 'Quét file rác' : 'Scan for junk'}</button></div> : <>
      {(state.scan.limited || state.scan.unreadable > 0) && <p className="inline-notice">{vi ? `Quét một phần: ${state.scan.unreadable} vị trí không đọc được${state.scan.limited ? '; đã chạm giới hạn quét' : ''}. Có thể dọn các file đã tìm thấy.` : `Partial scan: ${state.scan.unreadable} unreadable locations${state.scan.limited ? '; scan limit reached' : ''}. Found files can still be cleaned.`}</p>}
      <div className="cleanup-columns cleanup-table-head"><span>{vi ? 'Nhóm file' : 'File category'}</span><span>{vi ? 'Số file' : 'Files'}</span><span>{vi ? 'Dung lượng' : 'Size'}</span></div>
      {state.scan.groups.map(group => <div className="cleanup-category" key={group.id}><div className="cleanup-columns"><label><input type="checkbox" checked={selected.includes(group.id) && !group.unavailable && group.count > 0} disabled={busy || group.unavailable || group.count === 0 || expired} onChange={event => setSelected(previous => event.target.checked ? [...previous, group.id] : previous.filter(id => id !== group.id))} /><div><strong>{label(group.id)}</strong><small>{group.unavailable ? (vi ? 'Không có hoặc không đọc được thư mục' : 'Folder absent or unavailable') : (vi ? 'Chỉ file cũ hơn 7 ngày' : 'Only files older than 7 days')}</small></div></label><span>{group.unavailable ? '—' : group.count.toLocaleString()}</span><strong>{group.unavailable ? '—' : formatBytes(group.bytes)}</strong></div>{group.samples.length > 0 && <details className="file-samples"><summary>{vi ? 'Xem đường dẫn mẫu' : 'Preview sample paths'}</summary>{group.samples.map(file => <p className="mono" key={file}>{file}</p>)}<small>{vi ? 'Hiển thị tối đa 8 file mỗi nhóm.' : 'Up to 8 files per category.'}</small></details>}</div>)}
      </>}
      <div className="native-cleanup"><div><strong>{vi ? 'Thùng rác' : 'Recycle Bin'}</strong><p>{vi ? 'Quản lý bằng công cụ Windows' : 'Manage with Windows'}</p></div><button className="quiet" disabled={busy} onClick={() => void state.openTool('recycle')}>{vi ? 'Mở' : 'Open'} ↗</button></div>
      <div className="native-cleanup"><div><strong>{vi ? 'Dọn file hệ thống' : 'System file cleanup'}</strong><p>{vi ? 'Mở Disk Cleanup của Windows' : 'Open Windows Disk Cleanup'}</p></div><button className="quiet" disabled={busy} onClick={() => void state.openTool('disk')}>{vi ? 'Mở' : 'Open'} ↗</button></div>
    </section><aside className="surface cleanup-summary"><h2>{vi ? 'Đã chọn' : 'Selected'}</h2><div className="selected-bytes">{formatBytes(bytes)}</div><p>{count.toLocaleString()} {vi ? 'file' : 'files'} · {groups.filter(group => group.count > 0).length} {vi ? 'nhóm' : 'categories'}</p><hr /><p>{vi ? 'File đang sử dụng hoặc đã thay đổi sẽ được bỏ qua.' : 'Files in use or changed since scanning will be skipped.'}</p><div className="delete-warning">{vi ? 'Xóa file không thể hoàn tác.' : 'File deletion cannot be undone.'}</div>{expired && <p role="alert">{vi ? 'Lần quét đã hết hạn. Vui lòng quét lại.' : 'This scan has expired. Please scan again.'}</p>}<button disabled={busy || !count || expired} onClick={() => setPreview(true)}>{vi ? 'Xem trước khi dọn' : 'Review cleanup'}</button><small>{vi ? 'Không yêu cầu quyền quản trị cho các nhóm này.' : 'These categories do not require administrator access.'}</small></aside></div>
    <p className="cleanup-footnote">ⓘ {vi ? 'Không đụng đến Downloads, Desktop và tài liệu cá nhân.' : 'Downloads, Desktop and personal documents are outside the cleanup scope.'}</p>
    {preview && <dialog ref={dialog} className="preview-dialog cleanup-dialog" aria-labelledby="cleanup-confirm-title" onCancel={event => { event.preventDefault(); setPreview(false) }}><div className="preview-header"><div><p className="eyebrow">{vi ? 'KIỂM TRA TRƯỚC KHI XÓA' : 'REVIEW BEFORE DELETING'}</p><h2 id="cleanup-confirm-title">{vi ? 'Dọn các file đã chọn?' : 'Clean selected files?'}</h2><p>{count} {vi ? 'file' : 'files'} · {formatBytes(bytes)}</p></div><button className="quiet close-button" onClick={() => setPreview(false)} aria-label={vi ? 'Đóng' : 'Close'}>×</button></div><div className="preview-list">{groups.map(group => <div className="cleanup-preview-row" key={group.id}><strong>{label(group.id)}</strong><span>{group.count} file · {formatBytes(group.bytes)}</span></div>)}<p className="delete-warning">{vi ? 'Các file này sẽ bị xóa vĩnh viễn. Không thể khôi phục bằng nút Hoàn tác của Luma.' : 'These files will be permanently deleted. Luma’s Undo button cannot restore them.'}</p></div><div className="preview-footer"><p>{vi ? 'Một hộp thoại Windows sẽ yêu cầu xác nhận cuối cùng.' : 'A native dialog will ask for final confirmation.'}</p><div><button className="quiet" autoFocus onClick={() => setPreview(false)}>{vi ? 'Quay lại' : 'Back'}</button><button disabled={busy || expired} onClick={() => { setPreview(false); void state.clean(groups.filter(group => group.count > 0).map(group => group.id)) }}>{vi ? 'Tiếp tục' : 'Continue'}</button></div></div></dialog>}
  </>
}
