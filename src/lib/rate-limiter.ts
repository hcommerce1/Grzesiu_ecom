import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ─── Config ───
const MAX_REQUESTS_PER_MINUTE = 20;
const WINDOW_MS = 60_000; // 1 minute sliding window
const BLOCKED_BACKOFF_BASE_MS = 30_000; // 30s initial backoff
const BLOCKED_BACKOFF_MAX_MS = 300_000; // 5 min max backoff
const STATE_FILE = path.join(process.cwd(), 'tmp', 'rate-limiter-state.json');
const PRUNE_THRESHOLD_MS = 120_000; // prune timestamps older than 2 min
const DEDUP_WINDOW_MS = 5; // merge threshold for cross-instance dedup

// ─── Types ───
interface BlockedTokenInfo {
  tokenHash: string;
  blockedUntil: number;
  reason: string;
  consecutiveBlocks: number;
}

interface RateLimiterState {
  requestTimestamps: number[];
  blockedTokens: BlockedTokenInfo[];
  lastUpdated: number;
}

// ─── Blocked response detection ───
const BLOCKED_ERROR_CODES = [
  'TOO_MANY_REQUESTS',
  'ACCOUNT_BLOCKED',
  'TOKEN_BLOCKED',
];

const BLOCKED_MESSAGE_PATTERNS = [
  'too many requests',
  'rate limit',
  'blocked',
  'temporarily unavailable',
  'try again later',
];

function isBlockedResponse(response: {
  status?: string;
  error_code?: string;
  error_message?: string;
}): boolean {
  const code = (response.error_code ?? '').toUpperCase();
  const msg = (response.error_message ?? '').toLowerCase();
  return (
    BLOCKED_ERROR_CODES.some((p) => code.includes(p)) ||
    BLOCKED_MESSAGE_PATTERNS.some((p) => msg.includes(p))
  );
}

// ─── Priority types ───
export type Priority = 'high' | 'normal' | 'low';

// ─── In-memory state ───
let memoryTimestamps: number[] = [];
let memoryBlockedTokens: BlockedTokenInfo[] = [];

// Priority queue: waiting resolvers grouped by priority
const waitingQueue: { high: Array<() => void>; normal: Array<() => void>; low: Array<() => void> } = {
  high: [],
  normal: [],
  low: [],
};

function dequeueNext(): (() => void) | undefined {
  if (waitingQueue.high.length > 0) return waitingQueue.high.shift();
  if (waitingQueue.normal.length > 0) return waitingQueue.normal.shift();
  if (waitingQueue.low.length > 0) return waitingQueue.low.shift();
  return undefined;
}

// ─── Helpers ───
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureTmpDir(): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── File I/O (best-effort) ───
function loadStateFromFile(): RateLimiterState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const state = JSON.parse(raw) as RateLimiterState;
    const now = Date.now();
    // Prune old timestamps
    state.requestTimestamps = (state.requestTimestamps ?? []).filter(
      (t) => now - t < PRUNE_THRESHOLD_MS
    );
    // Prune expired blocks
    state.blockedTokens = (state.blockedTokens ?? []).filter(
      (b) => b.blockedUntil > now
    );
    return state;
  } catch (err) {
    console.warn(
      `[rate-limiter] Błąd odczytu pliku stanu — fallback na in-memory: ${err}`
    );
    return null;
  }
}

function saveStateToFile(state: RateLimiterState): void {
  try {
    ensureTmpDir();
    const tmpFile = STATE_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (err) {
    console.warn(
      `[rate-limiter] Błąd zapisu pliku stanu — kontynuacja in-memory: ${err}`
    );
  }
}

function mergeTimestamps(
  inMemory: number[],
  fromFile: number[]
): number[] {
  const merged = [...inMemory];
  for (const ft of fromFile) {
    // Add file timestamp only if not a duplicate of an in-memory one
    const isDuplicate = inMemory.some((mt) => Math.abs(mt - ft) < DEDUP_WINDOW_MS);
    if (!isDuplicate) {
      merged.push(ft);
    }
  }
  const now = Date.now();
  return merged
    .filter((t) => now - t < PRUNE_THRESHOLD_MS)
    .sort((a, b) => a - b);
}

function mergeBlockedTokens(
  inMemory: BlockedTokenInfo[],
  fromFile: BlockedTokenInfo[]
): BlockedTokenInfo[] {
  const map = new Map<string, BlockedTokenInfo>();
  const now = Date.now();

  // File state first, then in-memory overwrites (more recent)
  for (const b of fromFile) {
    if (b.blockedUntil > now) map.set(b.tokenHash, b);
  }
  for (const b of inMemory) {
    if (b.blockedUntil > now) {
      const existing = map.get(b.tokenHash);
      // Keep whichever has the later blockedUntil
      if (!existing || b.blockedUntil > existing.blockedUntil) {
        map.set(b.tokenHash, b);
      }
    }
  }
  return Array.from(map.values());
}

function getFullState(): RateLimiterState {
  const fileState = loadStateFromFile();
  const fileTimestamps = fileState?.requestTimestamps ?? [];
  const fileBlocked = fileState?.blockedTokens ?? [];

  const timestamps = mergeTimestamps(memoryTimestamps, fileTimestamps);
  const blocked = mergeBlockedTokens(memoryBlockedTokens, fileBlocked);

  // Update in-memory
  memoryTimestamps = timestamps;
  memoryBlockedTokens = blocked;

  return {
    requestTimestamps: timestamps,
    blockedTokens: blocked,
    lastUpdated: Date.now(),
  };
}

function findBlockedToken(
  state: RateLimiterState,
  tokenHash: string
): BlockedTokenInfo | undefined {
  return state.blockedTokens.find((b) => b.tokenHash === tokenHash);
}

// ─── Public API ───

/**
 * Czeka na dostępny slot w rate limiterze.
 * Wywołać PRZED każdym requestem do BaseLinker.
 * @param priority - 'high' = workflow (bootstrap, params, submit), 'low' = product details batch, 'normal' = default
 */
export async function acquireSlot(token: string, priority: Priority = 'normal'): Promise<void> {
  const tokenHash = hashToken(token);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const state = getFullState();

    // 1. Check if token is blocked
    const blocked = findBlockedToken(state, tokenHash);
    if (blocked && blocked.blockedUntil > Date.now()) {
      const waitMs = blocked.blockedUntil - Date.now() + 100; // +100ms safety
      console.warn(
        `[rate-limiter] Token ${tokenHash} zablokowany do ${new Date(blocked.blockedUntil).toISOString()} — oczekiwanie ${Math.round(waitMs / 1000)}s (próba: ${blocked.consecutiveBlocks})`
      );
      await sleep(waitMs);
      continue; // re-check after waiting
    }

    // 2. Check sliding window rate limit
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const recentTimestamps = state.requestTimestamps.filter(
      (t) => t > windowStart
    );

    if (recentTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
      // Wait until the oldest timestamp in the window expires
      const oldestInWindow = recentTimestamps[0];
      const delayMs = oldestInWindow + WINDOW_MS - now + 50; // +50ms jitter
      console.warn(
        `[rate-limiter] Oczekiwanie ${Math.round(delayMs / 1000)}s — limit ${MAX_REQUESTS_PER_MINUTE} req/min osiągnięty (${recentTimestamps.length}/${MAX_REQUESTS_PER_MINUTE}) [priorytet: ${priority}]`
      );
      // Instead of just sleeping, enqueue this request by priority
      await new Promise<void>((resolve) => {
        waitingQueue[priority].push(resolve);
        // Set a timer to wake the highest-priority waiter when slot opens
        sleep(delayMs).then(() => {
          const next = dequeueNext();
          if (next) next();
        });
      });
      continue; // re-check after waiting
    }

    // 3. Record timestamp and proceed
    const timestamp = Date.now();
    memoryTimestamps.push(timestamp);
    state.requestTimestamps.push(timestamp);
    state.lastUpdated = timestamp;
    saveStateToFile(state);
    return;
  }
}

/**
 * Analizuje response z BaseLinker i oznacza token jako zablokowany jeśli trzeba.
 * Wywołać PO każdym responsie z BaseLinker.
 */
export function handleResponse(
  token: string,
  response: {
    status?: string;
    error_code?: string;
    error_message?: string;
  }
): void {
  const tokenHash = hashToken(token);

  if (isBlockedResponse(response)) {
    // Mark token as blocked with exponential backoff
    const state = getFullState();
    const existing = findBlockedToken(state, tokenHash);
    const consecutiveBlocks = (existing?.consecutiveBlocks ?? 0) + 1;
    const backoffMs = Math.min(
      BLOCKED_BACKOFF_BASE_MS * Math.pow(2, consecutiveBlocks - 1),
      BLOCKED_BACKOFF_MAX_MS
    );
    const blockedUntil = Date.now() + backoffMs;

    const reason =
      response.error_code ?? response.error_message ?? 'unknown block';

    // Update or add blocked token
    const newBlocked: BlockedTokenInfo = {
      tokenHash,
      blockedUntil,
      reason,
      consecutiveBlocks,
    };

    memoryBlockedTokens = memoryBlockedTokens.filter(
      (b) => b.tokenHash !== tokenHash
    );
    memoryBlockedTokens.push(newBlocked);

    state.blockedTokens = state.blockedTokens.filter(
      (b) => b.tokenHash !== tokenHash
    );
    state.blockedTokens.push(newBlocked);
    state.lastUpdated = Date.now();
    saveStateToFile(state);

    console.warn(
      `[rate-limiter] Token ${tokenHash} zablokowany na ${Math.round(backoffMs / 1000)}s (próba: ${consecutiveBlocks}, powód: ${reason})`
    );
  } else if (response.status !== 'ERROR') {
    // Success — reset block counter if token was previously blocked
    const existing = memoryBlockedTokens.find(
      (b) => b.tokenHash === tokenHash
    );
    if (existing) {
      memoryBlockedTokens = memoryBlockedTokens.filter(
        (b) => b.tokenHash !== tokenHash
      );
      const state = getFullState();
      state.blockedTokens = state.blockedTokens.filter(
        (b) => b.tokenHash !== tokenHash
      );
      state.lastUpdated = Date.now();
      saveStateToFile(state);
      console.warn(`[rate-limiter] Token ${tokenHash} odblokowany`);
    }
  }
}

/**
 * Sprawdza czy dany token jest aktualnie zablokowany.
 */
export function isTokenBlocked(token: string): boolean {
  const tokenHash = hashToken(token);
  const state = getFullState();
  const blocked = findBlockedToken(state, tokenHash);
  return !!blocked && blocked.blockedUntil > Date.now();
}
