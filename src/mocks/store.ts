const Q = 500_000

const day = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })
}
const month = () => day().slice(0, 7)

export type Token = {
  id: number
  name: string
  key: string
  fullKey: string
  status: 1 | 2 | 3 | 4
  unlimited_quota: boolean
  remain_quota: number
  expired_time: number
  model_limits: string
  access_group_id: number
  group?: string
}

const db = {
  user: {
    id: 10086,
    display_name: 'lihongxu0221',
    username: 'lihongxu0221',
    quota: 0,
    settled_quota: 0,
    used_quota: 0,
    request_count: 0,
    concurrency_limit: 5,
    pending_quota: 0,
  },
  checkins: [] as { checkin_date: string; quota_awarded: number }[],
  tokens: [] as Token[],
  nextId: 1,
  redeemed: new Set<string>(),
  logs: [] as {
    id: number
    created_at: number
    model_name: string
    token_name: string
    prompt_tokens: number
    completion_tokens: number
    quota: number
  }[],
}

export const ok = <T,>(data: T) => ({ success: true as const, data })
export const fail = (message: string, code?: string) => ({
  success: false as const,
  data: null,
  message,
  code,
})

export const handlers = {
  status: () =>
    ok({
      quota_per_unit: Q,
      credit_unit: {
        raw_per_point: Q,
        display_name: '点',
        note: '1 点 = 500000 内部额度单位',
      },
    }),
  config: () =>
    ok({
      loginEnabled: true,
      turnstileSiteKey: '1x00000000000000000000AA',
      linuxdoClientId: 'mock-linuxdo-client',
    }),
  self: () => ok({ ...db.user }),
  dashboard: () =>
    ok({
      days: Array.from({ length: 7 }, (_, i) => ({
        date: day(i - 6),
        requests: 0,
      })),
    }),
  checkinGet: (m?: string) => {
    const mm = m || month()
    const records = db.checkins.filter((r) => r.checkin_date.startsWith(mm))
    const today = day()
    const checked = db.checkins.some((r) => r.checkin_date === today)
    return ok({
      enabled: true,
      // Demo allows claim when not checked; UI still supports exhausted messaging.
      claimable: !checked,
      unavailable_reason: checked
        ? '今日已签到'
        : undefined,
      min_quota: 2 * Q,
      max_quota: 2 * Q,
      month: mm,
      stats: {
        checked_in_today: checked,
        checkin_count: records.length,
        total_checkins: db.checkins.length,
        records,
      },
    })
  },
  checkinPost: () => {
    if (db.checkins.some((r) => r.checkin_date === day())) return fail('今日已签到')
    const quota_awarded = 2 * Q
    db.checkins.push({ checkin_date: day(), quota_awarded })
    db.user.quota += quota_awarded
    return ok({ quota_awarded })
  },
  topup: (key: string) => {
    const code = key.trim().toUpperCase()
    if (!code) return fail('请输入兑换码')
    if (db.redeemed.has(code)) return fail('兑换码已使用')
    if (!['WELCOME', 'GROK2026', 'COMMUNITY', 'DARKFORGER'].includes(code) && !code.startsWith('DF-')) {
      return fail('兑换码无效')
    }
    db.redeemed.add(code)
    const awarded = 5 * Q
    db.user.quota += awarded
    return ok(awarded)
  },
  tokens: (p = 1, size = 10) => {
    const start = (p - 1) * size
    return ok({
      items: db.tokens.slice(start, start + size).map(({ fullKey: _, ...rest }) => rest),
      total: db.tokens.length,
    })
  },
  tokenCreate: (body: Partial<Token> & { name: string }) => {
    const id = db.nextId++
    const fullKey = `sk-welfare-mock-${id}-${Math.random().toString(36).slice(2, 10)}`
    const item: Token = {
      id,
      name: body.name,
      key: `${fullKey.slice(0, 8)}****${fullKey.slice(-4)}`,
      fullKey,
      status: 1,
      unlimited_quota: !!body.unlimited_quota,
      remain_quota: body.remain_quota ?? 5 * Q,
      expired_time: body.expired_time ?? -1,
      model_limits: body.model_limits || '',
      access_group_id: 1,
      group: body.group || 'default',
    }
    db.tokens.unshift(item)
    return ok({ ...item, fullKey: undefined, key: item.key })
  },
  tokenUpdate: (body: { id: number } & Partial<Token>) => {
    const t = db.tokens.find((x) => x.id === body.id)
    if (!t) return fail('密钥不存在')
    Object.assign(t, body)
    return ok(t)
  },
  tokenStatus: (id: number, status: 1 | 2) => {
    const t = db.tokens.find((x) => x.id === id)
    if (!t) return fail('密钥不存在')
    t.status = status
    return ok(t)
  },
  tokenDelete: (id: number) => {
    const i = db.tokens.findIndex((x) => x.id === id)
    if (i < 0) return fail('密钥不存在')
    db.tokens.splice(i, 1)
    return ok(true)
  },
  tokenKey: (id: number) => {
    const t = db.tokens.find((x) => x.id === id)
    if (!t) return fail('密钥不存在')
    return ok(t.fullKey)
  },
  tokenOptions: () =>
    ok({
      groups: [{ id: 1, name: 'default', is_default: true, ratio: 1 }],
      model_details: [
        { id: 'grok-4.5', name: 'Grok 4.5', provider: 'xAI', kind: 'text', text_price: 3, text_out_price: 15 },
        { id: 'grok-4', name: 'Grok 4.0', provider: 'xAI', kind: 'text', text_price: 3, text_out_price: 15 },
        { id: 'grok-chat-auto', name: 'Grok chat auto', provider: 'xAI', kind: 'text', text_price: 1, text_out_price: 3 },
        { id: 'grok-chat-expert', name: 'Grok chat expert', provider: 'xAI', kind: 'text', text_price: 3, text_out_price: 15 },
        { id: 'grok-chat-fast', name: 'Grok chat fast', provider: 'xAI', kind: 'text', text_price: 0.2, text_out_price: 0.5 },
        { id: 'grok-heavy', name: 'Grok Heavy', provider: 'xAI', kind: 'text', text_price: 5, text_out_price: 25 },
        { id: 'grok-composer-2.5-fast', name: 'Grok composer 2.5 fast', provider: 'xAI', kind: 'text', text_price: 0.2, text_out_price: 0.5 },
        { id: 'grok-imagine-image', name: 'Grok Imagine - Image', provider: 'xAI', kind: 'image', image_price: 0.03 },
        { id: 'grok-imagine-image-2.0', name: 'Grok Imagine - Image 2.0', provider: 'xAI', kind: 'image', image_price: 0.05 },
        { id: 'grok-imagine-image-edit', name: 'Grok Imagine - Image Edit', provider: 'xAI', kind: 'image', image_price: 0.04 },
        { id: 'grok-imagine-image-lite', name: 'Grok Imagine - Image Lite', provider: 'xAI', kind: 'image', image_price: 0.02 },
        { id: 'grok-imagine-video', name: 'Grok Imagine - Video', provider: 'xAI', kind: 'video', video_price: 0.03 },
        { id: 'grok-imagine-video-1.5', name: 'Grok Imagine - Video 1.5', provider: 'xAI', kind: 'video', video_price: 0.05 },
      ],
    }),
  logs: (p = 1, page_size = 10) => {
    const start = (p - 1) * page_size
    return ok({ items: db.logs.slice(start, start + page_size), total: db.logs.length })
  },
  challenge: (purpose: string) =>
    ok({
      id: Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
      purpose,
      bits: 4,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }),
  verify: () => ok({ grant: 'mock-grant-' + Math.random().toString(36).slice(2) }),
  oauthState: () =>
    ok({
      flow_token: 'mock-flow-' + Date.now(),
      authorization_url: null as string | null,
    }),
  availability: () => {
    const now = new Date().toISOString()
    const hist = (rate: number) =>
      Array.from({ length: 7 }, (_, i) => ({
        checked_at: new Date(Date.now() - i * 86400000).toISOString(),
        status: Math.random() < rate ? 'operational' : 'down',
        latency_ms: 800 + Math.floor(Math.random() * 1200),
      }))
    const mk = (id: string, name: string, rate: number, latency: number, status = 'down') => ({
      id,
      name,
      status,
      latency_ms: latency,
      availability: Math.round(rate * 1000) / 10,
      history: hist(rate),
    })
    return ok({
      checked_at: now,
      groups: [
        {
          name: '默认分组',
          checked_at: now,
          models: [
            mk('grok-4.5', 'Grok 4.5', 0.713, 1480),
            mk('grok-4', 'Grok 4.0', 0.68, 1320),
            mk('grok-chat-auto', 'Grok Auto', 0.74, 980),
            mk('grok-chat-expert', 'Grok Expert', 0.71, 1510),
            mk('grok-chat-fast', 'Grok Fast', 0.82, 640),
            mk('grok-heavy', 'Grok Heavy', 0.55, 2400),
            mk('grok-composer-2.5-fast', 'Grok Composer 2.5 Fast', 0.79, 720),
            mk('grok-imagine-image', 'Grok Imagine', 0.66, 1800),
            mk('grok-imagine-image-2.0', 'Grok Imagine Image 2.0', 0.61, 2100),
            mk('grok-imagine-image-edit', 'Grok Imagine Image Edit', 0.58, 1950),
            mk('grok-imagine-image-lite', 'Grok Imagine Image Lite', 0.7, 1100),
            mk('grok-imagine-video', 'Grok Imagine Video', 0.42, 3200),
            mk('grok-imagine-video-1.5', 'Grok Imagine Video 1.5', 0.38, 3600),
          ],
        },
      ],
    })
  },
  pool: () =>
    ok({
      stale: false,
      items: Array.from({ length: 6 }, (_, i) => ({
        name: `Heavy-${String(i + 1).padStart(2, '0')}`,
        provider: 'xAI',
        tier: 'heavy',
        status: i % 5 === 0 ? 'exhausted' : 'available',
        quotas: [
          {
            mode: 'weekly',
            known: true,
            used: 20 + i * 11,
            limit: 100,
            reset_at: new Date(Date.now() + (7 - i) * 86400000).toISOString(),
          },
        ],
      })),
    }),
  leaderboard: (period = 'today', sort = 'credits', p = 1) => {
    const names = ['a***7', 'm***x', '蓝***云', 'c***9', '探***者', 'g***k', '星***海', 'n***2']
    const items = names.map((name, i) => ({
      rank: i + 1,
      name,
      calls: 40 - i * 3 + (period === 'all' ? 200 : period === '7d' ? 80 : 0),
      credits: 120 - i * 9 + (sort === 'calls' ? i : 0),
    }))
    return ok({ items, total: items.length, period, sort, page: p })
  },
  activity: (period = 'today') =>
    ok({
      period,
      items: [
        { model: 'grok-4.6', calls: 420, successful: 401, tokens: 1_200_000, credits: 86 },
        { model: 'grok-4', calls: 210, successful: 205, tokens: 540_000, credits: 41 },
        { model: 'grok-imagine-1.5', calls: 64, successful: 58, tokens: 0, credits: 22 },
        { model: 'grok-imagine-video-1.5', calls: 12, successful: 9, tokens: 0, credits: 18 },
      ],
    }),
  notices: (size = 50) =>
    ok({
      items: [
        {
          id: 'n3',
          level: 'danger',
          title: '重要 | 演示环境说明',
          body: '当前为前端克隆 + Mock API，并非官方 Darkforger 服务。请勿提交真实密钥。',
          published_at: '2026-09-20T20:00:00+08:00',
          ack_identity: 'n3-2026-09-20',
        },
        {
          id: 'n1',
          level: 'warning',
          title: '提醒 | 通用公告 | 每日额度使用规则',
          body: '请合理使用社区共享额度，勿自动签到或转售密钥。签到以北京时间为准。',
          published_at: '2026-09-18T10:00:00+08:00',
          ack_identity: 'n1-2026-09-18',
        },
        {
          id: 'n2',
          level: 'info',
          title: '欢迎来到 Darkforger 公益站',
          body: '从 Grok 起步，逐步拓展更多模型。本站演示克隆仅供本地预览。',
          published_at: '2026-09-10T09:00:00+08:00',
          ack_identity: 'n2-2026-09-10',
        },
      ].slice(0, size),
    }),
}
