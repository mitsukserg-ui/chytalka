// Офлайн-перекладач: моделі Mozilla (Firefox Translations) через рушій Bergamot.
// Іспанська → англійська → українська, усе в телефоні, без Інтернету.
import { LatencyOptimisedTranslator, TranslatorBacking } from './bergamot/translator.js';

const CACHE = 'chytalka-models-v1';
const BASE = new URL('./models/', import.meta.url);
const FILES = ['model.bin', 'lex.bin', 'vocab.spm'];
const PAIRS = ['esen', 'enuk'];
let manifest = null, translator = null;

async function cached(url, store = true) {
  const c = await caches.open(CACHE);
  const hit = await c.match(url);
  if (hit) return hit;
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  if (store) await c.put(url, r.clone());
  return r;
}
async function getManifest() {
  if (!manifest) manifest = await (await cached(new URL('models.json', BASE).href)).json();
  return manifest;
}
function partUrls(m) {
  const out = [];
  for (const pair of PAIRS) for (const f of FILES) for (const p of m[pair][f].parts) out.push(new URL(`${pair}/${p}`, BASE).href);
  return out;
}
async function loadFile(pair, f) {
  const m = (await getManifest())[pair][f];
  const out = new Uint8Array(m.size); let off = 0;
  for (const part of m.parts) {
    const b = new Uint8Array(await (await cached(new URL(`${pair}/${part}`, BASE).href)).arrayBuffer());
    out.set(b, off); off += b.length;
  }
  return out.buffer;
}

class LocalBacking extends TranslatorBacking {
  async loadModelRegistery() { return [{ from: 'es', to: 'en', files: {} }, { from: 'en', to: 'uk', files: {} }]; }
  async loadTranslationModel({ from, to }) {
    const pair = from + to;
    const [model, shortlist, vocab] = await Promise.all(FILES.map(f => loadFile(pair, f)));
    return { model, shortlist, vocabs: [vocab], config: {} };
  }
}

const OfflineTR = {
  /** Чи всі файли моделей уже збережені в телефоні */
  async isReady() {
    try {
      const m = await getManifest(); const c = await caches.open(CACHE);
      for (const u of partUrls(m)) if (!await c.match(u)) return false;
      return true;
    } catch (e) { return false; }
  },
  /** Розмір завантаження в байтах */
  async totalSize() {
    const m = await getManifest(); let s = 0;
    for (const pair of PAIRS) for (const f of FILES) s += m[pair][f].size;
    return s;
  },
  /** Завантажує моделі в телефон (один раз), onProgress(0..1) */
  async download(onProgress) {
    const m = await getManifest(); const c = await caches.open(CACHE);
    const total = await this.totalSize(); let done = 0;
    for (const pair of PAIRS) for (const f of FILES) {
      const meta = m[pair][f];
      for (let i = 0; i < meta.parts.length; i++) {
        const u = new URL(`${pair}/${meta.parts[i]}`, BASE).href;
        if (!await c.match(u)) {
          const r = await fetch(u, { cache: 'no-store' });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = await r.arrayBuffer();
          await c.put(u, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream' } }));
          done += buf.byteLength;
        } else done += Math.min(meta.partSize, meta.size - i * meta.partSize);
        onProgress && onProgress(Math.min(1, done / total));
      }
    }
    return true;
  },
  async remove() { translator && translator.delete(); translator = null; await caches.delete(CACHE); manifest = null; },
  async pair(from, to, text, html = false) {
    if (!translator) translator = new LatencyOptimisedTranslator({ downloadTimeout: 0, cacheSize: 200 }, new LocalBacking({ downloadTimeout: 0, cacheSize: 200 }));
    const r = await translator.translate({ from, to, text, html });
    return r.target.text.trim();
  },
  /** Речення з позначеним словом (<b>…</b>): тег переноситься на переклад слова */
  async translateHtml(html) {
    const en = await this.pair('es', 'en', html, true);
    return this.pair('en', 'uk', en, true);
  },
  /** Переклад з іспанської на українську. verb=true — словникова форма дієслова (інфінітив) */
  async translate(text, { verb = false } = {}) {
    if (verb) {
      // Дієслово з конектором: вставляємо в коротке речення, щоб отримати інфінітив і керування
      const en0 = await this.pair('es', 'en', `Voy a ${text} algo.`);
      const m = en0.match(/(?:going to|gonna)\s+(.+?)[.!]*$/i);
      if (m) {
        const v = m[1];
        const phrase = /\b(something|someone|somebody|it|anything)\b/i.test(v) ? v : v + ' something';
        const uk = await this.pair('en', 'uk', `I want to ${phrase}.`);
        const out = uk.replace(/^\s*(?:я\s+)?хочу,?\s*(?:щоб\s+)?/i, '').replace(/[.!]+$/, '').trim();
        if (out) return { text: out, en: v };
      }
    }
    const en = await this.pair('es', 'en', text);
    const uk = await this.pair('en', 'uk', en);
    return { text: uk.replace(/[.!]+$/, '').trim(), en };
  },
};
window.OfflineTR = OfflineTR;
window.dispatchEvent(new Event('offlinetr-ready'));
