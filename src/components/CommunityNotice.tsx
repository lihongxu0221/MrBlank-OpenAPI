import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Clock3,
  Info,
  Megaphone,
} from 'lucide-react'
import { api } from '../lib/api'
import { P } from '../i18n'
import { Modal } from './Modal'

type Notice = {
  id: string | number
  level: string
  title: string
  content?: string
  body?: string
  createdAt?: string
  updatedAt?: string
  published_at?: string
}

type NoticePayload = {
  items: Notice[]
  total?: number
  page?: number
  pageSize?: number
}

type NoticePrefs = {
  acknowledged: string[]
  hiddenDay: string
  hiddenRevisions: string[]
}

const STORAGE_KEY = 'welfare-notices-v2'

function revisionKey(n: Notice) {
  return `${n.id}:${n.updatedAt || n.createdAt || n.published_at || ''}`
}

function beijingDay(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function loadPrefs(): NoticePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (
      raw &&
      Array.isArray(raw.acknowledged) &&
      Array.isArray(raw.hiddenRevisions) &&
      typeof raw.hiddenDay === 'string'
    ) {
      return raw
    }
  } catch {
    /* ignore */
  }
  return { acknowledged: [], hiddenDay: '', hiddenRevisions: [] }
}

function visibleNotices(items: Notice[], prefs: NoticePrefs) {
  return items.filter(
    (n) =>
      !prefs.acknowledged.includes(revisionKey(n)) &&
      !(prefs.hiddenDay === beijingDay() && prefs.hiddenRevisions.includes(revisionKey(n))),
  )
}

function formatNoticeTime(iso?: string) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function noticeBody(n: Notice) {
  return n.content || n.body || ''
}

export function CommunityNotice({
  scrolled = false,
  suspended = false,
}: {
  scrolled?: boolean
  suspended?: boolean
}) {
  const [banner, setBanner] = useState<NoticePayload | null>(null)
  const [bannerError, setBannerError] = useState(false)
  const [page, setPage] = useState(1)
  const [pageData, setPageData] = useState<NoticePayload | null>(null)
  const [pageError, setPageError] = useState(false)
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<NoticePrefs>(loadPrefs)
  const [hideToday, setHideToday] = useState(false)
  const prompted = useRef(new Set<string>())

  const items = banner?.items || []

  useEffect(() => {
    let cancelled = false
    api
      .get<NoticePayload>('/api/welfare/notices?size=50', { auth: false })
      .then((d) => {
        if (!cancelled) {
          setBanner(d)
          setBannerError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setBannerError(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .get<NoticePayload>(`/api/welfare/notices?p=${page}&size=10`, { auth: false })
      .then((d) => {
        if (!cancelled) {
          setPageData(d)
          setPageError(false)
        }
      })
      .catch(() => {
        if (!cancelled) setPageError(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, page])

  useEffect(() => {
    if (suspended || !banner) return
    const urgent = visibleNotices(banner.items || [], prefs).filter(
      (n) => n.level === 'warning' || n.level === 'danger',
    )
    if (urgent.some((n) => !prompted.current.has(revisionKey(n)))) {
      urgent.forEach((n) => prompted.current.add(revisionKey(n)))
      setPage(1)
      setOpen(true)
    }
  }, [banner, prefs, suspended])

  function savePrefs(next: NoticePrefs) {
    setPrefs(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  function onCloseModal() {
    if (hideToday) {
      savePrefs({
        ...prefs,
        hiddenDay: beijingDay(),
        hiddenRevisions: items.map(revisionKey),
      })
    }
    setOpen(false)
  }

  function acknowledgePage() {
    const pageItems = pageData?.items || []
    const next: NoticePrefs = {
      ...prefs,
      acknowledged: [...new Set([...prefs.acknowledged, ...pageItems.map(revisionKey)])].slice(-500),
    }
    if (hideToday) {
      next.hiddenDay = beijingDay()
      next.hiddenRevisions = items.map(revisionKey)
    }
    savePrefs(next)
    setOpen(false)
  }

  const top = items[0]
  const total = pageData?.total ?? banner?.total ?? items.length
  const totalPages = Math.max(1, Math.ceil(total / 10))

  const levelIcon = useMemo(() => {
    if (!top) return Info
    if (top.level === 'danger' || top.level === 'warning') return AlertTriangle
    return Megaphone
  }, [top])

  if (!top || !banner) return null

  const LevelIcon = levelIcon
  const levelShort =
    top.level === 'danger' ? P('重要', 'Important') : top.level === 'warning' ? P('提醒', 'Notice') : P('公告', 'News')

  return (
    <>
      <aside
        className={`community-notice notice-${top.level} ${scrolled ? 'is-scrolled' : ''}`}
        aria-label={P('社区公告', 'Community announcement')}
      >
        <LevelIcon size={17} />
        <span className="notice-level">{levelShort}</span>
        <strong>{top.title}</strong>
        <button
          type="button"
          onClick={() => {
            setPage(1)
            setOpen(true)
          }}
        >
          <span>{P('全部公告', 'All notices')}</span>
          <ArrowUpRight size={15} />
        </button>
      </aside>

      {open && !suspended ? (
        <Modal title={P('社区公告', 'Community notices')} className="notice-history" onClose={onCloseModal}>
          <p className="notice-intro">
            {P('重要的变化，都在这里。时间统一为北京时间。', 'Everything you need to know. All times are Beijing time.')}
          </p>
          {(bannerError || pageError) && (
            <p role="alert">{P('公告刷新失败，正在重试。', 'Refresh failed. Retrying.')}</p>
          )}
          <div className="notice-timeline">
            {(pageData?.items || items).map((n) => {
              const when = n.updatedAt || n.createdAt || n.published_at
              const MetaIcon = n.level === 'danger' ? AlertTriangle : Info
              const levelLabel =
                n.level === 'danger'
                  ? P('重要公告', 'Important')
                  : n.level === 'warning'
                    ? P('使用提醒', 'Reminder')
                    : P('社区动态', 'Community')
              return (
                <article key={revisionKey(n)} className={`notice-entry notice-${n.level}`}>
                  <div className="notice-meta">
                    <span>
                      <MetaIcon size={14} /> {levelLabel}
                    </span>
                    <time dateTime={when}>
                      <Clock3 size={12} /> {formatNoticeTime(when)}
                    </time>
                  </div>
                  <h3>{n.title}</h3>
                  <div className="notice-copy">{noticeBody(n)}</div>
                  {prefs.acknowledged.includes(revisionKey(n)) ? (
                    <small className="notice-read">
                      <Check size={12} /> {P('已知晓', 'Acknowledged')}
                    </small>
                  ) : null}
                </article>
              )
            })}
          </div>
          {total > 10 ? (
            <div className="notice-pages">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                {P('上一页', 'Previous')}
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button type="button" disabled={page * 10 >= total} onClick={() => setPage((p) => p + 1)}>
                {P('下一页', 'Next')}
              </button>
            </div>
          ) : null}
          <div className="notice-actions">
            <label>
              <input type="checkbox" checked={hideToday} onChange={(e) => setHideToday(e.target.checked)} />
              {P('今日不再提示已有公告', 'Hide existing notices today')}
            </label>
            <button type="button" className="button primary" onClick={acknowledgePage}>
              <Check size={16} /> {P('本页已知晓', 'Acknowledge this page')}
            </button>
          </div>
          <p className="notice-footnote">
            {P(
              '新发布或更新的重要公告仍会提醒。您可以随时在公告栏查看历史记录。',
              'New or updated important notices still appear. You can always reopen the archive.',
            )}
          </p>
        </Modal>
      ) : null}
    </>
  )
}
