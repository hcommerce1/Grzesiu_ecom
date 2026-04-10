import { NextRequest, NextResponse } from "next/server"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ""
const LLM_MODEL = process.env.LLM_MODEL || "gpt-4o-mini"

export async function POST(req: NextRequest) {
  try {
    const { message, currentTitle, currentDescription } = await req.json()

    if (!OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Brak klucza OPENAI_API_KEY w .env.local" },
        { status: 500 }
      )
    }

    const systemPrompt = `Jesteś asystentem do edycji ofert e-commerce na Allegro.
Pomagasz modyfikować tytuł i opis produktu w odpowiedzi na polecenia użytkownika.

Aktualny tytuł produktu:
${currentTitle}

Aktualny opis:
${currentDescription || "(brak opisu)"}

Twoje zadanie:
- Zrozum polecenie użytkownika
- Zmodyfikuj tytuł i/lub opis zgodnie z poleceniem
- Pisz wyłącznie po polsku
- Tytuł Allegro: max 75 znaków, WIELKIE LITERY
- Opis: sprzedażowy, przyjazny, z korzyściami dla klienta

Zwróć odpowiedź jako JSON:
{
  "message": "krótki opis co zmieniłeś",
  "title": "nowy tytuł (jeśli zmieniony, inaczej null)",
  "description": "nowy opis (jeśli zmieniony, inaczej null)"
}`

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `OpenAI error ${response.status}`)
    }

    const data = await response.json()
    const raw = data.choices?.[0]?.message?.content || "{}"
    const result = JSON.parse(raw)

    return NextResponse.json({
      message: result.message || "Zaktualizowano.",
      title: result.title || null,
      description: result.description || null,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Nieznany błąd"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
