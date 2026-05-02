export function parseClaudeJson<T = unknown>(content: string): T {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  // 1. Try full parse
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // 2. Extract first JSON object or array from the string
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) as T; } catch { /* fall through */ }
    }
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try { return JSON.parse(arrMatch[0]) as T; } catch { /* fall through */ }
    }
    throw new SyntaxError(`Cannot parse JSON from Claude response: ${cleaned.slice(0, 120)}`);
  }
}
