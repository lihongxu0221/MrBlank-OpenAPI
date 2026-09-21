import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { formatCredits, setQuotaPerUnit } from '../../lib/format'
import { P } from '../../i18n'
import { ConsoleLayout } from './ConsoleLayout'
import { useToast } from '../../hooks/useStore'
import { Modal } from '../../components/Modal'

type Token = {
  id: number
  name: string
  key: string
  status: number
  unlimited_quota: boolean
  remain_quota: number
  expired_time: number
}

export function KeysPage({ path }: { path: string }) {
  const [items, setItems] = useState<Token[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [limit, setLimit] = useState('5')
  const [revealed, setRevealed] = useState<string | null>(null)
  const { toast, showToast } = useToast()

  async function load() {
    const status = await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })
    setQuotaPerUnit(status.quota_per_unit)
    const data = await api.get<{ items: Token[] }>('/api/token/?p=1&size=10')
    setItems(data.items || [])
  }

  useEffect(() => {
    load().catch((e) => showToast(e.message))
  }, [])

  async function create() {
    const remain = Math.round(Number(limit) * (await api.get<{ quota_per_unit: number }>('/api/status', { auth: false })).quota_per_unit)
    await api.post('/api/token/', {
      name,
      unlimited_quota: false,
      remain_quota: remain,
      expired_time: -1,
      model_limits: '',
      group: 'default',
    })
    setCreating(false)
    setName('')
    await load()
    showToast(P('密钥已创建'))
  }

  async function reveal(id: number) {
    const key = await api.post<string>(`/api/token/${id}/key`)
    setRevealed(typeof key === 'string' ? key : String(key))
  }

  async function toggle(id: number, status: 1 | 2) {
    await api.put('/api/token/?status_only=true', { id, status })
    await load()
  }

  async function remove(id: number) {
    await api.delete(`/api/token/${id}`)
    await load()
  }

  const statusLabel = (s: number) =>
    ({ 1: P('已启用'), 2: P('已停用'), 3: P('已过期'), 4: P('额度耗尽') }[s] || P('未知状态'))

  return (
    <ConsoleLayout path={path} title={P('API 密钥')} subtitle={P('为每一个工具，创建专属的访问密钥。')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div />
        <button type="button" className="button" onClick={() => setCreating(true)}>
          {P('创建密钥')}
        </button>
      </div>
      {!items.length ? (
        <div className="empty-state panel">
          <h3>{P('还没有 API 密钥')}</h3>
          <p>{P('创建一个密钥，让你的工具连接公益模型。')}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>{P('名称 / 密钥')}</th>
                <th>{P('状态')}</th>
                <th>{P('剩余额度')}</th>
                <th>{P('有效期')}</th>
                <th>{P('操作')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <div style={{ color: 'var(--muted)' }}>{t.key}</div>
                  </td>
                  <td>{statusLabel(t.status)}</td>
                  <td>{t.unlimited_quota ? P('跟随账户额度') : formatCredits(t.remain_quota)}</td>
                  <td>{t.expired_time < 0 ? P('长期') : new Date(t.expired_time * 1000).toLocaleDateString()}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="button ghost" onClick={() => reveal(t.id).catch((e) => showToast(e.message))}>
                      {P('查看密钥')}
                    </button>
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => toggle(t.id, t.status === 1 ? 2 : 1).catch((e) => showToast(e.message))}
                    >
                      {t.status === 1 ? P('停用') : P('启用')}
                    </button>
                    <button type="button" className="button ghost" onClick={() => remove(t.id).catch((e) => showToast(e.message))}>
                      {P('删除')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating ? (
        <Modal title={P('创建 API 密钥')} onClose={() => setCreating(false)}>
          <p className="appearance-intro">{P('为工具设置单独的额度上限与有效期，便于管理。')}</p>
          <div className="field">
            <label>{P('密钥名称')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={P('例如：我的桌面客户端')} />
          </div>
          <div className="field">
            <label>
              {P('额度上限')}
              {P('（点）')}
            </label>
            <input value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
          <button type="button" className="button" disabled={!name.trim()} onClick={() => create().catch((e) => showToast(e.message))}>
            {P('创建密钥')}
          </button>
        </Modal>
      ) : null}

      {revealed ? (
        <Modal title={P('查看密钥')} onClose={() => setRevealed(null)}>
          <p className="appearance-intro">{P('仅向你展示完整密钥。请保存在可信的密码管理器中。')}</p>
          <div className="endpoint-row">{revealed}</div>
          <button
            type="button"
            className="button"
            onClick={() => {
              navigator.clipboard?.writeText(revealed)
              showToast(P('已复制'))
            }}
          >
            {P('复制密钥')}
          </button>
          <p className="field-note">{P('关闭后从当前界面清除；不要将密钥分享给他人。')}</p>
        </Modal>
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </ConsoleLayout>
  )
}
