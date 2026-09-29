export type ConfigYamlPayload = {
  yaml: string
  config: Record<string, unknown>
  etag?: string
  bytes?: number
  secret_key?: { present: boolean; masked: string; action_default?: string }
  write_enabled?: boolean
  source?: string
  backup?: { name: string; sha256: string }
}

export type SecretKeyAction = 'keep' | 'clear' | 'replace'

export type ConfigTab = 'visual' | 'source' | 'connection'
