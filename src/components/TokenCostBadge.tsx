"use client"

import { useEffect, useState } from "react"
import { Coins } from "lucide-react"

interface Totals {
  total_input: number
  total_output: number
  total_usd: number
  total_pln: number
}

export function TokenCostBadge({ productId }: { productId: string }) {
  const [totals, setTotals] = useState<Totals | null>(null)

  useEffect(() => {
    if (!productId) return
    let cancelled = false

    const fetchTotals = async () => {
      try {
        const res = await fetch(`/api/token-usage?productId=${encodeURIComponent(productId)}`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.totals) setTotals(data.totals)
      } catch { /* ignore */ }
    }

    fetchTotals()
    const id = setInterval(fetchTotals, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [productId])

  if (!totals || !totals.total_pln) return null

  const tokens = (totals.total_input ?? 0) + (totals.total_output ?? 0)
  const tokensFmt = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
  const plnFmt = totals.total_pln.toFixed(2)

  return (
    <div
      title={`Łącznie: ${tokens.toLocaleString()} tokenów ($${(totals.total_usd ?? 0).toFixed(4)})`}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900"
    >
      <Coins className="size-3.5" />
      <span className="font-medium">{plnFmt} zł</span>
      <span className="text-amber-700/80">· {tokensFmt} tok</span>
    </div>
  )
}
