"use client"

import { useEffect, useState } from "react"
import { Database } from "lucide-react"

interface Totals {
  total_input: number
  total_output: number
  total_usd: number
  total_pln: number
}

export function GlobalTokenCostBadge() {
  const [totals, setTotals] = useState<Totals | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchTotals = async () => {
      try {
        const res = await fetch("/api/token-usage")
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.totals) setTotals(data.totals)
      } catch { /* ignore */ }
    }

    fetchTotals()
    const id = setInterval(fetchTotals, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!totals || !totals.total_pln) return null

  const tokens = (totals.total_input ?? 0) + (totals.total_output ?? 0)
  const tokensFmt = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  const plnFmt = totals.total_pln.toFixed(2)
  const usdFmt = (totals.total_usd ?? 0).toFixed(4)

  return (
    <div
      title={`Łączny koszt API Claude (powinno = panel Anthropic): $${usdFmt} · ${tokens.toLocaleString()} tokenów`}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-xs text-blue-900"
    >
      <Database className="size-3.5" />
      <span className="font-medium">{plnFmt} zł</span>
      <span className="text-blue-700/80">· {tokensFmt} tok</span>
    </div>
  )
}
