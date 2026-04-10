import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { QueryProvider } from "@/components/QueryProvider"
import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext"],
})

export const metadata: Metadata = {
  title: "Allegro / BaseLinker — Menedżer ofert",
  description: "Scrapuj produkty, generuj opisy i wystawiaj oferty na Allegro przez BaseLinker.",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground font-sans">
        <QueryProvider>
          {children}
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  )
}
