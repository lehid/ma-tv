// Vérifie les flux de MA sélection (avant filtrage des morts) → public/data/status.json
// Usage : node scripts/check-streams.mjs [--all]   (--all = tout le catalogue mondial, long)
import { join } from 'node:path';
import { loadCatalog, loadConfig, filterEntries, writeJSON, DATA, isMain } from './lib/api.mjs';

const CONCURRENCY = Number(process.env.CHECK_CONCURRENCY || 24);
const TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 8000);
const DEFAULT_UA = 'Mozilla/5.0 (SMART-TV; Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export async function checkStream(e) {
  if (!/^https?:/i.test(e.url)) return { ok: null, reason: 'protocole non testé' };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers = { 'user-agent': e.userAgent || DEFAULT_UA };
    if (e.referrer) headers.referer = e.referrer;
    const res = await fetch(e.url, { headers, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) { res.body?.cancel(); return { ok: false, code: res.status, ms: Date.now() - t0 }; }
    // Lit seulement le début : suffisant pour reconnaître un manifest HLS.
    const reader = res.body.getReader();
    let head = '';
    while (head.length < 2048) {
      const { value, done } = await reader.read();
      if (done) break;
      head += new TextDecoder().decode(value);
    }
    reader.cancel().catch(() => {});
    const isHls = head.trimStart().startsWith('#EXTM3U');
    const type = res.headers.get('content-type') || '';
    const ok = isHls || /video|mpegurl|octet-stream|mp2t|dash/i.test(type);
    return { ok, code: res.status, ms: Date.now() - t0, ...(ok ? {} : { reason: 'pas un flux vidéo' }) };
  } catch (err) {
    return { ok: false, ms: Date.now() - t0, reason: err.name === 'AbortError' ? 'timeout' : String(err.cause?.code || err.message) };
  } finally {
    clearTimeout(timer);
  }
}

async function pool(items, n, fn) {
  let i = 0;
  let done = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
      if (++done % 100 === 0) console.log(`  … ${done}/${items.length}`);
    }
  });
  await Promise.all(workers);
}

if (isMain(import.meta.url)) {
  const cfg = await loadConfig();
  const { entries } = await loadCatalog();
  const list = process.argv.includes('--all') ? entries : filterEntries(entries, cfg);
  console.log(`Vérification de ${list.length} flux (concurrence ${CONCURRENCY}, timeout ${TIMEOUT_MS} ms)…`);
  const results = {};
  await pool(list, CONCURRENCY, async (e) => { results[e.url] = await checkStream(e); });
  const vals = Object.values(results);
  const ok = vals.filter((r) => r.ok).length;
  const ko = vals.filter((r) => r.ok === false).length;
  await writeJSON(join(DATA, 'status.json'), { checkedAt: new Date().toISOString(), ok, ko, results });
  console.log(`✔ status.json : ${ok} OK, ${ko} KO, ${vals.length - ok - ko} non testés`);
}
