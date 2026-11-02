import { useEffect, useRef, useState } from 'react'
import { findApp, findTweak } from './catalog'
import { useI18n, type Key } from './i18n'
import type { OpResult, Scan } from './types'

export type TaskReport = {
  kind: string
  folder?: string
  results: OpResult[]
  message?: string
}

export function PreviewDialog({ ids, scan, busy, onClose, onApply }: {
  ids: string[]; scan: Scan; busy: boolean; onClose: () => void; onApply: (ids: string[]) => void
}) {
  const { t, lang } = useI18n()
  const vi = lang === 'vi'
  const dialog = useRef<HTMLDialogElement>(null)
  const blocked = (id: string) => id.startsWith('startup:') && (!!scan.keptStartup?.includes(id) || !!scan.startup.find(item => item.id === id)?.protected)
  const eligible = ids.filter(id => !blocked(id))
  const [selected, setSelected] = useState(() => new Set(eligible))
  const chosen = eligible.filter(id => selected.has(id))
  const reboot = chosen.some(id => scan.tweaks[id]?.reboot || findTweak(id)?.risk === 'reboot')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog className="preview-dialog" ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} aria-labelledby="preview-title">
    <div className="preview-header"><div><p className="eyebrow">{vi ? 'BẠN CHỌN, LUMA THỰC HIỆN' : 'YOUR CHOICES, YOUR PC'}</p><h2 id="preview-title">{vi ? 'Xem trước thay đổi' : 'Review your changes'}</h2><p>{vi ? 'Chỉ những mục được chọn bên dưới sẽ được áp dụng.' : 'Only the selected items below will be applied.'}</p></div><button className="quiet close-button" disabled={busy} onClick={onClose} aria-label={vi ? 'Đóng' : 'Close'}>×</button></div>
    <div className="preview-selection"><span>{chosen.length} / {eligible.length} {vi ? 'đã chọn' : 'selected'}</span><button className="quiet" disabled={busy} onClick={() => setSelected(new Set(chosen.length === eligible.length ? [] : eligible))}>{chosen.length === eligible.length ? (vi ? 'Bỏ chọn tất cả' : 'Deselect all') : (vi ? 'Chọn tất cả' : 'Select all')}</button></div>
    <div className="preview-list">{ids.map(id => {
      const tweak = findTweak(id)
      const app = findApp(id)
      const startup = scan.startup.find(item => item.id === id)
      const title = tweak || app ? t(`${id}.title` as Key) : startup?.name || id
      const detail = tweak || app ? t(`${id}.detail` as Key) : (vi ? 'Tắt chạy cùng Windows. Bạn vẫn mở ứng dụng bình thường.' : 'Disable launch at sign-in. You can still open the app normally.')
      const risk = tweak?.risk || 'choice'
      return <label className={`preview-item${blocked(id) ? ' preview-kept' : ''}`} key={id}><input type="checkbox" checked={selected.has(id) && !blocked(id)} disabled={busy || blocked(id)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(id); else next.delete(id); return next })} /><div><strong>{title}</strong><p>{detail}</p><small>{blocked(id) ? (vi ? 'Được giữ nguyên' : 'Kept unchanged') : tweak ? t(`${id}.apply` as Key) : app ? t('apps.remove') : t('startup.off')}</small></div><span className={`risk${risk === 'risk' ? ' hot' : ''}`}>{t(`risk.${risk}`)}</span></label>
    })}</div>
    <div className="preview-footer"><p>{reboot ? (vi ? 'Một số thay đổi cần khởi động lại máy.' : 'Some changes require a restart.') : (vi ? 'Kết quả từng mục sẽ xuất hiện sau khi hoàn tất.' : 'You’ll see a result for each item when finished.')}</p><div><button className="quiet" disabled={busy} onClick={onClose}>{vi ? 'Quay lại' : 'Back'}</button><button disabled={busy || !chosen.length} onClick={() => onApply(chosen)}>{vi ? `Áp dụng ${chosen.length} thay đổi` : `Apply ${chosen.length} changes`}</button></div></div>
  </dialog>
}

export function ResultPanel({ report, busy, onRetry, onClose }: { report: TaskReport; busy: boolean; onRetry: () => void; onClose: () => void }) {
  const { lang } = useI18n()
  const vi = lang === 'vi'
  const failed = report.results.filter(item => !item.ok).length
  const skipped = report.results.filter(item => item.ok && item.skipped).length
  const success = report.results.filter(item => item.ok && !item.skipped).length
  return <section className="result-panel" aria-label={vi ? 'Kết quả tác vụ' : 'Task results'}>
    <div className="result-heading"><div><h2>{vi ? 'Kết quả tác vụ' : 'Task results'}</h2><p role="status">{vi ? `${success} thành công · ${failed} lỗi · ${skipped} bỏ qua` : `${success} succeeded · ${failed} failed · ${skipped} skipped`}</p></div><button className="quiet close-button" onClick={onClose} aria-label={vi ? 'Đóng kết quả' : 'Dismiss results'}>×</button></div>
    <details open={failed > 0}><summary>{vi ? 'Chi tiết từng mục' : 'Item details'}</summary><div className="result-items">{report.results.map((item, index) => <div className="result-item" key={`${item.id}-${index}`}><div><strong>{item.label || item.id}</strong>{item.message && <p>{item.message}</p>}{item.reboot && <p>{vi ? 'Cần khởi động lại máy.' : 'Restart required.'}</p>}</div><span className={`result-status ${!item.ok ? 'failed' : item.skipped ? 'skipped' : ''}`}>{!item.ok ? (vi ? 'Thất bại' : 'Failed') : item.skipped ? (vi ? 'Bỏ qua' : 'Skipped') : (vi ? 'Thành công' : 'Succeeded')}</span></div>)}</div></details>
    {report.message && !report.results.some(item => item.message === report.message) && <p className="result-message">{report.message}</p>}
    {report.results.some(item => item.reboot) && <p className="result-message">{vi ? 'Khởi động lại máy để hoàn tất các thay đổi được đánh dấu.' : 'Restart your PC to finish the marked changes.'}</p>}
    {failed > 0 && <button className="quiet retry-failed" disabled={busy} onClick={onRetry}>{vi ? `Thử lại ${failed} mục lỗi` : `Retry ${failed} failed items`}</button>}
  </section>
}

export function StartupPanel({ scan, busy, onToggle, onKeep, onRefresh }: {
  scan: Scan; busy: boolean; onToggle: (id: string, enabled: boolean) => void; onKeep: (id: string, kept: boolean) => void; onRefresh: () => void
}) {
  const { t, lang } = useI18n()
  const vi = lang === 'vi'
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name')
  const kept = new Set(scan.keptStartup ?? [])
  const enabled = scan.startup.filter(item => item.enabled).length
  const rank = { high: 2, mid: 1, none: 0 }
  const rows = scan.startup.filter(item => {
    const matches = `${item.name} ${item.publisher} ${item.command}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    return matches && (filter === 'all' || filter === 'on' && item.enabled || filter === 'off' && !item.enabled || filter === 'kept' && kept.has(item.id))
  }).sort((a, b) => (sort === 'impact' ? rank[b.impact] - rank[a.impact] : sort === 'state' ? Number(b.enabled) - Number(a.enabled) : 0) || a.name.localeCompare(b.name, lang))
  return <>
    <p className="eyebrow">{vi ? 'KHỞI ĐỘNG THEO CÁCH CỦA BẠN' : 'START ON YOUR TERMS'}</p><div className="startup-heading"><h1>{t('startup.title')}</h1><button className="quiet" disabled={busy} onClick={onRefresh}>{vi ? 'Quét lại' : 'Refresh'}</button></div><p className="lead">{t('startup.lead')}</p>
    <div className="list-summary"><span><strong>{enabled}</strong> {vi ? 'đang bật' : 'enabled'}</span><span><strong>{scan.startup.length - enabled}</strong> {vi ? 'đang tắt' : 'disabled'}</span><span><strong>{scan.startup.filter(item => kept.has(item.id)).length}</strong> {vi ? 'luôn giữ' : 'kept'}</span></div>
    <div className="startup-toolbar"><label><span>{vi ? 'Tìm ứng dụng' : 'Search apps'}</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={vi ? 'Tên, nhà phát hành, đường dẫn…' : 'Name, publisher, path…'} /></label><label><span>{vi ? 'Hiển thị' : 'Show'}</span><select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">{vi ? 'Tất cả' : 'All apps'}</option><option value="on">{vi ? 'Đang bật' : 'Enabled'}</option><option value="off">{vi ? 'Đang tắt' : 'Disabled'}</option><option value="kept">{vi ? 'Luôn giữ' : 'Always keep'}</option></select></label><label><span>{vi ? 'Sắp xếp' : 'Sort by'}</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="name">{vi ? 'Tên ứng dụng' : 'App name'}</option><option value="impact">{vi ? 'Tác động ước lượng' : 'Estimated impact'}</option><option value="state">{vi ? 'Trạng thái' : 'State'}</option></select></label></div>
    <div className="table-labels startup-columns"><span>{rows.length} {vi ? 'ứng dụng' : 'apps'}</span><span>{vi ? 'Lưu ý' : 'Risk'}</span><span>{vi ? 'Khởi động cùng máy' : 'Launch at sign-in'}</span></div>
    {rows.length === 0 && <div className="empty-panel">{scan.startup.length ? (vi ? 'Không có ứng dụng khớp bộ lọc.' : 'No apps match your filters.') : t('startup.empty')}</div>}
    {rows.map(item => <div className="row startup-row startup-columns" key={item.id}><div className="app-cell"><span className="app-avatar">{item.name.slice(0, 1).toUpperCase()}</span><div><h2>{item.name}</h2><div className="cmd" title={item.command}>{item.publisher || item.command}</div><p className="item-meta">{vi ? 'Tác động ước lượng' : 'Estimated impact'}: {t(`impact.${item.impact}`)}</p><label className="keep-choice"><input type="checkbox" checked={kept.has(item.id)} disabled={busy} onChange={event => onKeep(item.id, event.target.checked)} />{vi ? 'Luôn giữ trong hồ sơ tự động' : 'Always keep in automatic profiles'}</label></div></div><span className={item.protected ? 'risk hot' : 'risk'}>{item.protected ? (vi ? 'Bảo mật / driver' : 'Security / driver') : t('risk.choice')}</span><button type="button" role="switch" aria-checked={item.enabled} aria-label={`${item.name}: ${vi ? 'Khởi động cùng máy' : 'Launch at sign-in'}`} className={`startup-toggle ${item.enabled ? 'is-on' : ''}`} disabled={busy} onClick={() => onToggle(item.id, !item.enabled)}><span>{item.enabled ? (vi ? 'Đang bật' : 'On') : (vi ? 'Đang tắt' : 'Off')}</span><span className="switch-track"><span /></span></button></div>)}
    <div className="safety-note"><div><strong>{vi ? 'Bạn vẫn có thể bật/tắt thủ công mọi lúc' : 'Manual switches remain in your control'}</strong><p>{vi ? '“Luôn giữ” chỉ ngăn hồ sơ tự động tắt ứng dụng; không tự bật ứng dụng đang tắt. Tác động là ước lượng theo tên ứng dụng, chưa phải kết quả đo.' : '“Always keep” prevents automatic profiles from disabling an app; it does not enable an app that is off. Impact is estimated from the app name, not measured.'}</p></div></div>
  </>
}
