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
    display_name: '探索者',
    username: 'dev_explorer',
    quota: 12.5 * Q,
    settled_quota: 3.2 * Q,
    used_quota: 3.2 * Q,
    request_count: 128,
    concurrency_limit: 5,
    pending_quota: 0,
  },
  checkins: [
    { checkin_date: day(-1), quota_awarded: 2 * Q },
    { checkin_date: day(-3), quota_awarded: 1.5 * Q },
  ],
  tokens: [
    {
      id: 1,
      name: '桌面客户端',
      key: 'sk-welf****emo1',
      fullKey: 'sk-welfare-mock-desktop-key-demo-001',
      status: 1 as const,
      unlimited_quota: false,
      remain_quota: 5 * Q,
      expired_time: -1,
      model_limits: '',
      access_group_id: 1,
      group: 'default',
    },
  ] as Token[],
  nextId: 2,
  redeemed: new Set<string>(),
  logs: Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    created_at: Math.floor(Date.now() / 1000) - i * 18000,
    model_name: ['grok-4.6', 'grok-4', 'grok-imagine-1.5'][i % 3],
    token_name: '桌面客户端',
    prompt_tokens: 120 + i * 17,
    completion_tokens: 80 + i * 9,
    quota: Math.round((0.02 + i * 0.01) * Q),
  })),
}

export const ok = <T,>(data: T) => ({ success: true as const, data })
export const fail = (message: string, code?: string) => ({
  success: false as const,
  data: null,
  message,
  code,
})

export const handlers = {
  status: () => ok({ quota_per_unit: Q }),
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
        requests: [12, 8, 21, 5, 30, 18, 9][i],
      })),
    }),
  checkinGet: (m?: string) => {
    const mm = m || month()
    const records = db.checkins.filter((r) => r.checkin_date.startsWith(mm))
    const today = day()
    const checked = db.checkins.some((r) => r.checkin_date === today)
    return ok({
      enabled: true,
      claimable: !checked,
      unavailable_reason: checked ? '今日已签到' : undefined,
      min_quota: 1 * Q,
      max_quota: 3 * Q,
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
        { id: 'grok-4.6', name: 'Grok 4.6', kind: 'text', text_price: 1, image_price: 0, video_price: 0 },
        { id: 'grok-4', name: 'Grok 4', kind: 'text', text_price: 1, image_price: 0, video_price: 0 },
        { id: 'grok-imagine-1.5', name: 'Grok Imagine 1.5', kind: 'image', text_price: 0, image_price: 8, video_price: 0 },
        { id: 'grok-imagine-video-1.5', name: 'Grok Imagine Video 1.5', kind: 'video', text_price: 0, image_price: 0, video_price: 40 },
        { id: 'claude-4-sonnet', name: 'Claude 4 Sonnet', kind: 'text', text_price: 1, image_price: 0, video_price: 0, planned: true },
        { id: 'gpt-5', name: 'GPT-5', kind: 'text', text_price: 1, image_price: 0, video_price: 0, planned: true },
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
      Array.from({ length: 24 }, (_, i) => ({
        checked_at: new Date(Date.now() - i * 3600000).toISOString(),
        status: Math.random() < rate ? 'operational' : 'degraded',
        latency_ms: 180 + Math.floor(Math.random() * 400),
      }))
    return ok({
      checked_at: now,
      groups: [
        {
          name: '文本与推理',
          checked_at: now,
          models: [
            { id: 'grok-4.6', status: 'operational', latency_ms: 312, history: hist(0.95) },
            { id: 'grok-4', status: 'operational', latency_ms: 280, history: hist(0.92) },
          ],
        },
        {
          name: '图像创作',
          checked_at: now,
          models: [{ id: 'grok-imagine-1.5', status: 'operational', latency_ms: 890, history: hist(0.88) }],
        },
        {
          name: '视频生成',
          checked_at: now,
          models: [{ id: 'grok-imagine-video-1.5', status: 'degraded', latency_ms: 2400, history: hist(0.7) }],
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
