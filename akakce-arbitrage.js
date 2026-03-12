/**
 * akakce-arbitrage.js
 *
 * Akakçe "Fark Atan Fiyatlar" sayfasını tarar.
 * Elektronik kategorisinde, EN UCUZ SATICI Amazon / Amazon Prime / Media Markt
 * olan ve 2. en ucuz fiyatla arasındaki fark %5'ten fazla olan ürünleri bulur.
 * Sonuçları arbitrage_runs + arbitrage_items tablolarına kaydeder.
 *
 * Manuel çalıştırma : node akakce-arbitrage.js
 * Cron               : server.js içinde her gün 04:00'da tetiklenir
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const db        = require('./database/db');

// ─── Ayarlar ─────────────────────────────────────────────────────────────────

const DEALS_BASE_URL   = 'https://www.akakce.com/fark-atan-fiyatlar/';
const MAX_PAGES        = 8;
const PAGE_DELAY_MS    = 2000;
const PRODUCT_DELAY_MS = 1500;
const MIN_GAP_PCT      = 5.0;   // % fark eşiği

// Akakçe'deki img[alt] değerleriyle birebir eşleşmeli
const TARGET_ALTS = new Set(['Amazon Türkiye', 'Amazon Prime', 'Media Markt']);

// Çıktıda gösterilecek etiketler
const ALT_TO_LABEL = {
  'Amazon Türkiye': 'Amazon',
  'Amazon Prime':   'Amazon Prime',
  'Media Markt':    'MediaMarkt',
};

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isTarget(raw) {
  return TARGET_ALTS.has((raw || '').trim());
}

function toLabel(raw) {
  return ALT_TO_LABEL[(raw || '').trim()] || raw.trim();
}

// ─── Tarayıcı ─────────────────────────────────────────────────────────────────

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

async function makePage(browser) {
  const p = await browser.newPage();
  await p.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await p.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
  return p;
}

// ─── Adım 1: Ürün linklerini topla ───────────────────────────────────────────

async function collectLinks(page) {
  const seen = new Set();

  for (let n = 1; n <= MAX_PAGES; n++) {
    const url = n === 1 ? DEALS_BASE_URL : `${DEALS_BASE_URL}?p=${n}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_DELAY_MS);

      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => /akakce\.com\/[^?#]+,\d+\.html/.test(h))
          .filter((v, i, a) => a.indexOf(v) === i)
      );

      const newCount = links.filter(l => !seen.has(l)).length;
      links.forEach(l => seen.add(l));
      console.log(`  Sayfa ${n}: ${links.length} link (+${newCount} yeni, toplam ${seen.size})`);

      if (newCount === 0) { console.log('  Yeni link yok, duruyorum.'); break; }
      await sleep(1000);
    } catch (e) {
      console.error(`  Sayfa ${n} hata: ${e.message.slice(0, 70)}`);
      break;
    }
  }

  return [...seen];
}

// ─── Adım 2: Ürün sayfasını tara ─────────────────────────────────────────────

async function scrapeProduct(page, url) {
  // 3 deneme
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_DELAY_MS);
      break;
    } catch (e) {
      if (attempt === 3) return null;
      await sleep(3000);
    }
  }

  try {
    return await page.evaluate(() => {
      // Elektronik mi?
      const isElec = Array.from(document.querySelectorAll('a'))
        .some(a => a.textContent.trim() === 'Elektronik');

      // Ürün adı
      const h1 = document.querySelector('h1[class*="v_h"], h1.v_h, h1');
      const name = h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : '';

      // Satıcı + fiyat listesi
      const rows = document.querySelectorAll('ul.pl_v9 > li, ul[class*="pl_v"] > li');
      const sellers = [];

      rows.forEach(li => {
        const span = li.querySelector('span.v_v8');
        let sellerRaw = '';
        if (span) {
          const img = span.querySelector('img[alt]');
          sellerRaw = img
            ? img.alt.trim()
            : span.textContent.trim().replace(/^\//, '').replace(/\s+/g, ' ');
        }

        // Kampanya fiyatı tercih edilir, yoksa normal fiyat
        const priceEl =
          li.querySelector('span.pt_v8.cmpgn_pt_v8') ||
          li.querySelector('span.pt_v8:not(.orig_pt_v8):not(.cmpgn_pt_v8)');
        const priceRaw = priceEl ? priceEl.textContent.replace(/\s/g, '') : '';

        const m = priceRaw.match(/([\d.]+)[,](\d{2})/);
        const price = m ? parseFloat(m[1].replace(/\./g, '') + '.' + m[2]) : 0;

        const a = li.querySelector('a[href]');
        const offerUrl = a ? a.href : '';

        if (sellerRaw && price > 0) sellers.push({ sellerRaw, price, offerUrl });
      });

      return { isElec, name, sellers };
    });
  } catch (e) {
    console.error(`  [hata] ${url.slice(0, 55)}: ${e.message.slice(0, 60)}`);
    return null;
  }
}

// ─── Adım 3: Arbitraj fırsatı bul ────────────────────────────────────────────

function findArbitrage(sellers) {
  if (!sellers || sellers.length < 2) return null;

  const sorted = [...sellers].sort((a, b) => a.price - b.price);
  const cheapest = sorted[0];
  const second   = sorted[1];

  // En ucuz satıcı hedef satıcılardan biri olmalı
  if (!isTarget(cheapest.sellerRaw)) return null;

  const gapTL  = second.price - cheapest.price;
  const gapPct = (gapTL / cheapest.price) * 100;

  if (gapPct <= MIN_GAP_PCT) return null;

  return {
    cheapestRaw:      cheapest.sellerRaw,
    cheapestLabel:    toLabel(cheapest.sellerRaw),
    cheapestPrice:    cheapest.price,
    cheapestUrl:      cheapest.offerUrl,
    secondLabel:      toLabel(second.sellerRaw),
    secondPrice:      second.price,
    secondUrl:        second.offerUrl,
    gapTL:            Math.round(gapTL * 100) / 100,
    gapPct:           Math.round(gapPct * 100) / 100,
  };
}

// ─── Adım 4: DB'ye kaydet ────────────────────────────────────────────────────

function ensureTables() {
  return Promise.all([
    new Promise(resolve => db.run(`
      CREATE TABLE IF NOT EXISTS arbitrage_runs (
        id            SERIAL PRIMARY KEY,
        run_timestamp TEXT NOT NULL,
        total_scanned INTEGER DEFAULT 0,
        total_results INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT NOW()
      )`, resolve)),
    new Promise(resolve => db.run(`
      CREATE TABLE IF NOT EXISTS arbitrage_items (
        id                 SERIAL PRIMARY KEY,
        run_id             INTEGER NOT NULL REFERENCES arbitrage_runs(id) ON DELETE CASCADE,
        product_name       TEXT,
        product_url        TEXT,
        cheapest_seller    TEXT,
        cheapest_price     REAL,
        cheapest_offer_url TEXT,
        second_seller      TEXT,
        second_price       REAL,
        second_offer_url   TEXT,
        gap_tl             REAL,
        gap_pct            REAL,
        created_at         TIMESTAMP DEFAULT NOW()
      )`, resolve)),
  ]);
}

function insertRun(runTs, totalScanned, totalResults) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO arbitrage_runs (run_timestamp, total_scanned, total_results) VALUES ($1,$2,$3)`,
      [runTs, totalScanned, totalResults],
      function(err) { err ? reject(err) : resolve(this.lastID); }
    );
  });
}

function insertItems(runId, results) {
  if (!results.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const placeholders = results.map((_, i) => {
      const b = i * 10 + 2;
      return `($1,$${b},$${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`;
    }).join(',');
    const params = [runId];
    results.forEach(r => {
      params.push(
        r.name, r.url,
        r.arb.cheapestLabel, r.arb.cheapestPrice, r.arb.cheapestUrl,
        r.arb.secondLabel,   r.arb.secondPrice,   r.arb.secondUrl,
        r.arb.gapTL, r.arb.gapPct
      );
    });
    db.run(
      `INSERT INTO arbitrage_items
         (run_id,product_name,product_url,
          cheapest_seller,cheapest_price,cheapest_offer_url,
          second_seller,second_price,second_offer_url,
          gap_tl,gap_pct)
       VALUES ${placeholders}`,
      params,
      err => err ? reject(err) : resolve()
    );
  });
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

async function run() {
  const runTs = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const line  = '─'.repeat(65);
  console.log(`\n${line}`);
  console.log(`[${new Date().toISOString()}]  Akakçe arbitraj taraması`);
  console.log(line);

  const stats = { elec: 0, isTarget: 0, notElec: 0, notTarget: 0, gapLow: 0, errors: 0 };
  const results = [];

  await ensureTables();

  let browser;
  try {
    browser = await launchBrowser();
    const page = await makePage(browser);

    // 1) Linkleri topla
    console.log('\n▶ Ürün linkleri toplanıyor…');
    const allLinks = await collectLinks(page);
    const total = allLinks.length;
    console.log(`\n  ${total} benzersiz ürün linki.\n`);
    if (!total) { console.log('  ⚠ Link bulunamadı.'); return; }

    // 2) Her ürünü tara + filtrele
    for (let i = 0; i < total; i++) {
      const link   = allLinks[i];
      const prefix = `[${String(i + 1).padStart(3)}/${total}]`;

      const product = await scrapeProduct(page, link);

      if (!product || !product.name) {
        stats.errors++;
        continue;
      }

      if (!product.isElec) {
        stats.notElec++;
        continue;
      }
      stats.elec++;

      const arb = findArbitrage(product.sellers);

      if (!arb) {
        const sorted = [...product.sellers].sort((a, b) => a.price - b.price);
        if (sorted.length < 2 || !isTarget(sorted[0]?.sellerRaw)) stats.notTarget++;
        else stats.gapLow++;
        continue;
      }

      stats.isTarget++;
      results.push({ name: product.name, url: link, arb });

      console.log(
        `${prefix} ✓ ${product.name.slice(0, 36).padEnd(38)} ` +
        `${arb.cheapestLabel} @ ${arb.cheapestPrice.toLocaleString('tr-TR')}₺ → ` +
        `${arb.secondLabel} @ ${arb.secondPrice.toLocaleString('tr-TR')}₺ ` +
        `(+${arb.gapPct.toFixed(1)}%)`
      );

      await sleep(PRODUCT_DELAY_MS + Math.random() * 500);
    }

  } catch (e) {
    console.error(`\n[KRİTİK HATA] ${e.message}`);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }

  // 3) DB'ye kaydet
  try {
    const runId = await insertRun(runTs, results.length > 0 ? results.length + stats.notElec + stats.notTarget + stats.gapLow + stats.errors : 0, results.length);
    if (results.length) await insertItems(runId, results);
    console.log(`\n  DB: ${results.length} fırsat kaydedildi (run_id=${runId})`);
  } catch (e) {
    console.error(`  DB kayıt hatası: ${e.message}`);
  }

  // 4) Özet
  console.log(`\n${line}`);
  console.log(
    `[${new Date().toISOString()}]  Tamamlandı` +
    `  |  Fırsat: ${results.length}` +
    `  Elektronik: ${stats.elec}` +
    `  Hedef değil: ${stats.notTarget}` +
    `  Fark az: ${stats.gapLow}` +
    `  Elektronik değil: ${stats.notElec}`
  );
  console.log(`${line}\n`);

  // Top 5
  if (results.length) {
    console.log('  EN İYİ FIRSATLAR:\n');
    [...results].sort((a, b) => b.arb.gapPct - a.arb.gapPct).slice(0, 5).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name.slice(0, 55)}`);
      console.log(`     Alış  : ${r.arb.cheapestLabel} @ ${r.arb.cheapestPrice.toLocaleString('tr-TR')}₺`);
      console.log(`     Satış : ${r.arb.secondLabel} @ ${r.arb.secondPrice.toLocaleString('tr-TR')}₺`);
      console.log(`     Fark  : ${r.arb.gapTL.toLocaleString('tr-TR')}₺  (${r.arb.gapPct.toFixed(1)}%)\n`);
    });
  }
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
