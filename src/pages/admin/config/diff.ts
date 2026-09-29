/** Minimal line diff for confirm dialog (no external dep). */
export function lineDiff(before: string, after: string): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const a = before.split('\n')
  const b = after.split('\n')
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = []
  // LCS DP for small configs is fine
  const n = a.length
  const m = b.length
  if (n + m > 4000) {
    // fallback: show truncated raw
    for (const line of a.slice(0, 80)) out.push({ kind: 'del', text: line })
    for (const line of b.slice(0, 80)) out.push({ kind: 'add', text: line })
    out.push({ kind: 'same', text: '… (diff truncated)' })
    return out
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i++] })
    } else {
      out.push({ kind: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'add', text: b[j++] })
  return out
}
