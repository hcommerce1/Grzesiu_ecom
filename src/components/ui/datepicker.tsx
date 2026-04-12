"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export interface DatePickerProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  includeTime?: boolean
}

const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  ({ className, includeTime = false, ...props }, ref) => {
    return (
      <input
        type={includeTime ? "datetime-local" : "date"}
        ref={ref}
        className={cn(
          "h-9 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:pointer-events-none disabled:opacity-50 [color-scheme:light]",
          className
        )}
        {...props}
      />
    )
  }
)
DatePicker.displayName = "DatePicker"

export { DatePicker }
