export type QuotaSnap = {
  remaining_ratio?: number | null
  remaining?: number | null
  limit?: number | null
  window?: string | null
  resets_at?: string | null
  risk?: string | null
  plan_type?: string | null
  observed_at_ms?: number
  source?: string
}

export type QuotaWindow = {
  label: string
  remaining_ratio?: number | null
  remaining?: number | null
  limit?: number | null
  resets_at?: string | null
  risk?: string | null
  used_cost?: number | null
  used_tokens?: number | null
  forecast_cost?: number | null
  forecast_tokens?: number | null
}

export type Account = {
  id: string
  name?: string | null
  label?: string
  email?: string | null
  provider?: string | null
  status?: string | null
  display_status?: string | null
  disabled?: boolean
  unavailable?: boolean
  success?: number
  failed?: number
  last_refresh?: string | null
  created_at?: string | null
  updated_at?: string | null
  status_message?: string
  note?: string | null
  priority?: number | null
  weight?: number | null
  proxy_url?: string | null
  prefix?: string | null
  websockets?: boolean | null
  cooling?: unknown
  excluded_models?: unknown
  plan_type?: string | null
  auth_index?: string | number | null
  recent_requests?: { time?: string; success?: number; failed?: number }[]
  quota?: QuotaSnap | null
  quota_windows?: QuotaWindow[] | null
  usage_cost?: number | null
  usage_tokens?: number | null
}

export type Pool = {
  total: number
  active: number
  unavailable: number
  disabled: number
  need_reauth?: number
  attention?: number
  quota_risk?: number
  unconfirmed?: number
  by_provider: { provider: string; count: number }[]
}

export type ViewMode = 'table' | 'card'
