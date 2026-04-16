import Anthropic from '@anthropic-ai/sdk';
import type { ProductData } from './types';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface TranslationResult {
    title: string;
    description: string;
    attributes: Record<string, string>;
}

async function callLLM(systemPrompt: string, userContent: string): Promise<string> {
    const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
    });

    const text = (response.content[0] as { type: 'text'; text: string }).text || '';
    // Strip markdown code fences if model wraps JSON despite instructions
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

/**
 * Tlumaczy tylko tytul i atrybuty (BEZ generowania opisu).
 * Uzyj tego w nowym flow, gdzie opis generowany jest osobno.
 */
export async function translateProductBasic(product: ProductData): Promise<ProductData> {
    const basicPrompt = `Na podstawie poniższych danych produktu:
1. Przetłumacz tytuł produktu na polski (naturalnie brzmiące tłumaczenie, NIE tytuł aukcji Allegro)
2. Przetłumacz wszystkie atrybuty (klucze i wartości) na polski
3. Przetłumacz opis na polski (wierne tłumaczenie, nie twórz opisu sprzedażowego)

Pisz wyłącznie po polsku. Zachowaj sens i dokładność tłumaczenia.

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{
  "title": "przetłumaczony tytuł",
  "description": "przetłumaczony opis",
  "attributes": { "klucz_po_polsku": "wartość_po_polsku", ... }
}`;

    try {
        const payload = {
            title: product.title,
            description: product.description,
            attributes: product.attributes,
        };

        const responseText = await callLLM(
            basicPrompt,
            `Przetłumacz poniższe dane produktu na polski:\n\n${JSON.stringify(payload, null, 2)}`,
        );
        const translated: TranslationResult = JSON.parse(responseText);

        return {
            ...product,
            title: translated.title || product.title,
            description: translated.description || product.description,
            attributes: translated.attributes || product.attributes,
        };
    } catch (err) {
        console.error('LLM basic translation failed:', err);
        throw err;
    }
}

/**
 * Pelne tlumaczenie + generowanie opisu sprzedazowego (stary flow, fallback).
 */
export async function translateProduct(product: ProductData, customPrompt?: string): Promise<ProductData> {
    const defaultPrompt = `Na podstawie poniższego opisu producenta stwórz profesjonalny tytuł aukcji Allegro oraz skuteczny, sprzedażowy opis produktu. Oferta będzie wystawiona na polskim Allegro.

### Tytuł Allegro:
- Maksymalnie 75 znaków (wykorzystaj jak najwięcej)
- Nie używaj znaków specjalnych (żadnych: !, *, +, emoji itp.)
- Tytuł ma być czytelny, konkretny i brzmieć naturalnie po polsku
- Zachowaj sens oryginalnej nazwy produktu — nie dodawaj informacji, których nie ma w danych (np. kolor, materiał, marka) chyba że są w atrybutach
- Umieść 2-3 naturalne frazy kluczowe, ale NIE rób listy słów kluczowych — tytuł musi brzmieć jak normalna nazwa produktu
- Przykład dobrego tytułu: "NOWOCZESNA KONSOLA 100 CM STOLIK Z GEOMETRYCZNĄ PODSTAWĄ"
- Przykład złego tytułu: "KONSOLA 100 CM BIAŁA GEOMETRYCZNA PODSTAWA MDF TRIBESIGNS"

### Opis sprzedażowy:
- Pisz językiem korzyści – pokaż co klient ZYSKUJE dzięki temu produktowi
- Na początku dodaj chwytliwy nagłówek sprzedażowy (1-2 zdania)
- Następnie wypunktuj 4–6 głównych zalet (każda jako osobny punkt, bez ikon i znaków specjalnych)
- Dodaj 1–2 akapity przyjaznego, prostego opisu, który pomaga klientowi wyobrazić sobie, jak używa produktu (scenariusze użycia, emocje, komfort, oszczędność)
- Umieść przejrzystą specyfikację techniczną w formie listy
- Zakończ wezwaniem do działania – prostym, konkretnym CTA

Pisz tytuły WIELKIMI LITERAMI.
Unikaj kopiowania opisu producenta – przeredaguj go na język codzienny, przyjazny, zrozumiały dla kupującego.
Styl: ludzki, informacyjny, nastawiony na sprzedaż.
Dostosuj język i styl do jednej z kategorii: dom, ogród, dziecko, warsztat, zwierzę.
Pisz wyłącznie po polsku.

TYTUŁY WIELKIMI LITERAMI.
Nie pisz nazwy marki jako pierwszego słowa w tytule, tylko w późniejszej części.
NIGDY NIE PISZ NIC O GWARANCJI PRODUCENTA.
NIE UŻYWAJ EMOJI!

Oto przykład dobrego Tytułu dla fotela: 
FOTEL RELAKSACYJNY OBROTOWY ROZKŁADANY Z PODNÓŻKIEM FLEXISPOT XC6 BRĄZ

Oto przykład dobrego opisu sprzedażowego dla fotela:

WYGODNY FOTEL DO RELAKSU W SALONIE
Usiądź wygodnie, odchyl oparcie i odpocznij po długim dniu. Fotel FLEXISPOT XC6 łączy funkcję rozkładania, bujania i pełnego obrotu, dzięki czemu zapewnia wyjątkowy komfort podczas oglądania telewizji, czytania książki lub popołudniowej drzemki.

NAJWAŻNIEJSZE ZALETY
• Manualne rozkładanie oparcia i podnóżka do wygodnej pozycji relaksu

• Funkcja obrotu 360 stopni zapewnia pełną swobodę ruchu

• Delikatne bujanie zwiększa komfort odpoczynku

• Szerokie siedzisko i gruba tapicerka dla wygodnego podparcia ciała

• Stabilna stalowa konstrukcja zapewniająca trwałość i bezpieczeństwo

• Praktyczny schowek boczny na piloty, książki lub drobiazgi

IDEALNY FOTEL DO CODZIENNEGO RELAKSU
Fotel FLEXISPOT XC6 został zaprojektowany tak, aby zapewnić maksymalny komfort w domowym salonie. Wystarczy delikatnie odchylić oparcie, aby wysunąć podnóżek i przejść do wygodnej pozycji półleżącej.

Funkcja obrotu pozwala swobodnie zmieniać kierunek siedzenia bez przesuwania fotela, a delikatny ruch bujania pomaga się odprężyć po intensywnym dniu pracy. Miękka tapicerka oraz szerokie podłokietniki zapewniają wygodne podparcie dla pleców i ramion.

Fotel świetnie sprawdzi się w salonie, sypialni, domowym biurze lub kąciku do czytania.

FOTEL RELAKSACYJNY OBROTOWY ROZKŁADANY Z PODNÓŻKIEM FLEXISPOT XC6 BRĄZ
SPECYFIKACJA TECHNICZNA
• Model FLEXISPOT XC6

• Typ fotela rozkładany manualnie

• Funkcja obrotu 360 stopni

• Funkcja bujania

• Maksymalny kąt odchylenia około 145 stopni

• Maksymalna nośność około 159 kg

• Konstrukcja stalowa stabilna podstawa

• Materiał obicia tkanina poliester

• Wymiary w pozycji siedzącej około 100 x 98 x 107 cm

• Wymiary w pozycji rozłożonej około 162 x 98 x 79 cm

• Kolor brązowy pomarańczowy

STWÓRZ WYGODNĄ STREFĘ RELAKSU
Wybierz fotel FLEXISPOT XC6 i ciesz się komfortowym miejscem do odpoczynku w swoim domu. Idealny do oglądania filmów, czytania lub relaksu po pracy.

Spróbuj zachować tą formę i styl dla każdego produktu, który będzie tłumaczony. Pamiętaj, że tytuł musi być w WIELKICH LITERACH, a opis powinien być atrakcyjny i nastawiony na sprzedaż.

Odpowiedz WYŁĄCZNIE poprawnym JSON bez markdown:
{
  "title": "tytuł allegro WIELKIMI LITERAMI",
  "description": "pełny opis sprzedażowy",
  "attributes": { "klucz": "wartość", ... }
}`;

    try {
        const payload = {
            title: product.title,
            description: product.description,
            attributes: product.attributes,
        };

        const hasCustomPrompt = typeof customPrompt === 'string' && customPrompt.trim().length > 0;
        const sysContent = hasCustomPrompt ? customPrompt.trim() : defaultPrompt;
        const finalPrompt = sysContent.toLowerCase().includes('json')
            ? sysContent
            : sysContent + '\n\nOdpowiedz WYŁĄCZNIE poprawnym JSON bez markdown.';

        const userInstruction = hasCustomPrompt
            ? 'Apply the system instructions to this product data and return the transformed result.'
            : 'Stwórz profesjonalny tytuł i opis dla Allegro na podstawie poniższych danych produktu.';

        const responseText = await callLLM(
            finalPrompt,
            `${userInstruction}\n\n${JSON.stringify(payload, null, 2)}`,
        );
        const translated: TranslationResult = JSON.parse(responseText);

        return {
            ...product,
            title: translated.title || product.title,
            description: translated.description || product.description,
            attributes: translated.attributes || product.attributes,
        };
    } catch (err) {
        console.error('LLM translation failed:', err);
        throw err;
    }
}
