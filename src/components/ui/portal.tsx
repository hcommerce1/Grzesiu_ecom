"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    ref.current = document.body
    setMounted(true)
  }, [])

  if (!mounted || !ref.current) return null
  return createPortal(children, ref.current)
}
