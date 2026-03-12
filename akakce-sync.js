/**
 * akakce-sync.js
 *
 * https://www.akakce.com/fark-atan-fiyatlar/ sayfasını tarar.
 * Elektronik kategorisindeki ürünlerde Amazon Türkiye / Amazon Prime /
 * Media Markt satıcısı varsa; bu perakendeciler HARİÇ en ucuz satıcı
 * fiyatıyla ürünleri sitemize otomatik ekler / günceller.
 *
 * Manuel çalıştırma : node akakce-sync.js
 * Cron               : server.js içinde her gün 03:00'da tetiklenir
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const db        = require('./database/db');

// ─── Ayarlar ─────────────────────────────────────────────────────────────────

const DEALS_BASE_URL   = 'https://www.akakce.com/fark-atan-fiyatlar/';
const MAX_PAGES        = 8;     // kaç sayfa taransın
const PAGE_DELAY_MS    = 2500;  // sayfa yüklemesi sonrası bekleme (ms)
const PRODUCT_DELAY_MS = 2000;  // ürünler arası bekleme (ms)

// Akakçe'deki satıcı adları — img[alt] değerleriyle birebir eşleşmeli
const BIG_RETAILER_NAMES = ['Amazon Türkiye', 'Amazon Prime', 'Media Markt'];

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Satıcı adının büyük perakendecilerden biri olup olmadığını kontrol eder.
 * Akakçe'de satıcı adları img[alt] attribute'undan gelir; değerler:
 *   "Amazon Türkiye" | "Amazon Prime" | "Media Markt"
 */
function isBig(sellerName) {
  return BIG_RETAILER_NAMES.some(r => r.toLowerCase() === (sellerName || '').toLowerCase().trim());
}

// ─── Tarayıcı ─────────────────────────────────────────────────────────────────

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu', '--lang=tr-TR,tr',
    ],
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

// ─── Adım 1: Fark-atan listesinden ürün URL'lerini topla ─────────────────────

async function collectProductLinks(page) {
  const seen = new Set();

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = pageNum === 1 ? DEALS_BASE_URL : `${DEALS_BASE_URL}?p=${pageNum}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_DELAY_MS);

      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => /akakce\.com\/[^?#]+,\d+\.html/.test(h))
          .filter((v, i, arr) => arr.indexOf(v) === i)
      );

      if (!links.length) { console.log(`  Sayfa ${pageNum}: boş, duruyorum.`); break; }

      let added = 0;
      links.forEach(l => { if (!seen.has(l)) { seen.add(l); added++; } });
      console.log(`  Sayfa ${pageNum}: ${links.length} link  (+${added} yeni, toplam ${seen.size})`);

      if (added === 0) break;
      await sleep(1000);
    } catch (e) {
      console.error(`  Sayfa ${pageNum} hata: ${e.message.slice(0, 70)}`);
      break;
    }
  }

  return [...seen];
}

// ─── Adım 2: Ürün sayfasını tara ─────────────────────────────────────────────
//
// Doğrulanmış Akakçe HTML yapısı:
//   ul.pl_v9 > li
//     span.pt_v8              → fiyat  ("1.234,56 TL" formatında)
//     span.pt_v8.orig_pt_v8   → üstü çizili orijinal fiyat — ATLANIR
//     span.pt_v8.cmpgn_pt_v8  → kampanya/indirimli fiyat (varsa bunu kullan)
//     span.v_v8 > img[alt]    → büyük mağaza logosu, alt = satıcı adı
//     span.v_v8 (text)        → küçük satıcı adı (bazen "/" ile başlar)
//
//  Elektronik filtresi: breadcrumb'da "Elektronik" veya "elektronik" geçiyor mu?
//  (URL slug yerine sayfa içi breadcrumb kullanılır — direksiyon-seti, powerbank
//   gibi tüm alt kategoriler otomatik yakalanır)

async function scrapeProductPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_DELAY_MS);

    return await page.evaluate(() => {

      // ── Elektronik mi? (breadcrumb <a> linki kontrolü) ───────────────────
      const isElectronics = Array.from(document.querySelectorAll('a'))
        .some(a => a.textContent.trim() === 'Elektronik');

      // ── Ürün adı ──────────────────────────────────────────────────────────
      const h1 = document.querySelector('h1[class*="v_h"], h1.v_h, h1');
      const name = h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Ana ürün resmi ────────────────────────────────────────────────────
      const imgEl =
        document.querySelector('img.v_img') ||
        document.querySelector('img[itemprop="image"]') ||
        document.querySelector('[class*="product-img"] img') ||
        document.querySelector('[class*="v_th"] img');
      const imageUrl = imgEl
        ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy') || imgEl.src || '')
        : '';

      // ── Marka ─────────────────────────────────────────────────────────────
      const brandEl =
        document.querySelector('[itemprop="brand"]') ||
        document.querySelector('a[class*="brand_"]') ||
        document.querySelector('[class*="brand_"]');
      const brand = brandEl ? brandEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Kısa ürün açıklaması ──────────────────────────────────────────────
      const specEl =
        document.querySelector('[class*="spec_v"]') ||
        document.querySelector('[class*="ozellik"]') ||
        document.querySelector('[itemprop="description"]');
      const description = specEl
        ? specEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 500)
        : '';

      // ── Satıcı + fiyat listesi ────────────────────────────────────────────
      const sellers = [];
      const rows = document.querySelectorAll('ul.pl_v9 > li, ul[class*="pl_v"] > li');

      rows.forEach(li => {
        // Satıcı adı
        const sellerSpan = li.querySelector('span.v_v8');
        let sellerName = '';
        if (sellerSpan) {
          const logo = sellerSpan.querySelector('img[alt]');
          sellerName = logo
            ? logo.alt.trim()                                          // büyük mağaza: img alt
            : sellerSpan.textContent.trim().replace(/^\//, '').replace(/\s+/g, ' '); // küçük satıcı: text
        }

        // Efektif fiyat: kampanya varsa onu al, yoksa normal fiyatı al
        const priceEl =
          li.querySelector('span.pt_v8.cmpgn_pt_v8') ||
          li.querySelector('span.pt_v8:not(.orig_pt_v8):not(.cmpgn_pt_v8)');
        const rawPrice = priceEl ? priceEl.textContent.replace(/\s/g, '') : '';

        const m = rawPrice.match(/([\d.]+)[,](\d{2})/);
        if (m && sellerName) {
          const price = parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
          if (price > 0) sellers.push({ seller: sellerName.slice(0, 80), price });
        }
      });

      return { isElectronics, name, imageUrl, brand, description, sellers };
    });

  } catch (e) {
    console.error(`  [hata] ${url.slice(0, 55)}: ${e.message.slice(0, 60)}`);
    return null;
  }
}

// ─── Adım 3: İkinci en iyi fiyatı bul ────────────────────────────────────────

function findTarget(sellers) {
  if (!sellers || sellers.length === 0) return null;
  const sorted = [...sellers].sort((a, b) => a.price - b.price);

  // En ucuz satıcı Amazon / Prime / Media Markt olmalı
  if (!isBig(sorted[0].seller)) return null;

  // 2. en ucuz satıcı (kim olursa olsun)
  return sorted[1] || null;
}

// ─── Adım 4: DB'ye upsert ────────────────────────────────────────────────────

function upsertProduct({ name, imageUrl, brand, description, akakceUrl, targetPrice, targetSeller }) {
  return new Promise(resolve => {
    db.get(
      `SELECT id FROM products WHERE name ILIKE $1 LIMIT 1`,
      [`${name.slice(0, 50)}%`],
      (_err, existing) => {
        if (existing) {
          db.run(
            `UPDATE products
               SET tane_price = $1,
                   image_url  = COALESCE(NULLIF(image_url,''), $2),
                   tane_url   = $3
             WHERE id = $4`,
            [targetPrice, imageUrl || null, akakceUrl, existing.id],
            () => {
              console.log(`  ↻ GÜNCELLENDİ  ${name.slice(0, 48).padEnd(50)} → ${targetPrice.toLocaleString('tr-TR')}₺`);
              resolve(existing.id);
            }
          );
        } else {
          const desc = description ||
            `${name}${brand ? ' — ' + brand : ''}. ${targetSeller} hariç en iyi fiyat.`;
          db.run(
            `INSERT INTO products
               (name, image_url, description, category, brand, tane_price, tane_url, stock)
             VALUES ($1,$2,$3,$4,$5,$6,$7,99)`,
            [name, imageUrl || null, desc.slice(0, 500), 'Elektronik', brand || null, targetPrice, akakceUrl],
            function (err2) {
              if (!err2) {
                console.log(`  + EKLENDI      ${name.slice(0, 48).padEnd(50)} → ${targetPrice.toLocaleString('tr-TR')}₺  (${targetSeller.slice(0, 28)})`);
              } else {
                console.error(`  [db hata] ${err2.message.slice(0, 80)}`);
              }
              resolve(this?.lastID || null);
            }
          );
        }
      }
    );
  });
}

// ─── Ana fonksiyon ────────────────────────────────────────────────────────────

async function run() {
  const startedAt = new Date();
  const line = '─'.repeat(65);
  console.log(`\n${line}`);
  console.log(`[${startedAt.toISOString()}]  Akakçe fark-atan-fiyatlar sync`);
  console.log(line);

  let browser;
  const stats = { processed: 0, noElec: 0, noBig: 0, noOther: 0, errors: 0 };

  try {
    browser = await launchBrowser();
    const page = await makePage(browser);

    // 1) Fark-atan listesindeki tüm ürün linklerini topla
    console.log('\n▶ Ürün linkleri toplanıyor…');
    const allLinks = await collectProductLinks(page);
    console.log(`\n  ${allLinks.length} toplam ürün linki.\n`);
    if (!allLinks.length) { console.log('  ⚠ Link bulunamadı.'); return; }

    // 2) Her ürünü tara
    for (let i = 0; i < allLinks.length; i++) {
      const link    = allLinks[i];
      const prefix  = `[${String(i + 1).padStart(3)}/${allLinks.length}]`;

      const product = await scrapeProductPage(page, link);

      if (!product || !product.name) {
        console.log(`${prefix} atlandı (veri alınamadı)`);
        stats.errors++;
        continue;
      }

      // Elektronik filtresi (breadcrumb'dan)
      if (!product.isElectronics) {
        console.log(`${prefix} atlandı — elektronik değil`);
        stats.noElec++;
        continue;
      }

      const target = findTarget(product.sellers);

      if (!target) {
        const sorted0 = [...product.sellers].sort((a, b) => a.price - b.price);
        const cheapestIsBig = sorted0.length && isBig(sorted0[0].seller);
        console.log(`${prefix} atlandı — ${cheapestIsBig ? '2. satıcı yok' : 'en ucuz Amazon/MMarkt değil'}`);
        cheapestIsBig ? stats.noOther++ : stats.noBig++;
        continue;
      }

      const cheapest = [...product.sellers].sort((a, b) => a.price - b.price)[0];
      console.log(`${prefix} ${product.name.slice(0, 40)} | en ucuz: ${cheapest.seller.slice(0, 18)} @ ${cheapest.price.toLocaleString('tr-TR')}₺ → 2. fiyat: ${target.seller.slice(0, 18)} @ ${target.price.toLocaleString('tr-TR')}₺`);

      await upsertProduct({
        name:         product.name,
        imageUrl:     product.imageUrl,
        brand:        product.brand,
        description:  product.description,
        akakceUrl:    link,
        targetPrice:  target.price,
        targetSeller: target.seller,
      });
      stats.processed++;

      await sleep(PRODUCT_DELAY_MS + Math.random() * 1000);
    }

  } catch (e) {
    console.error(`\n[KRİTİK HATA] ${e.message}`);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(`\n${line}`);
  console.log(
    `[${new Date().toISOString()}]  Tamamlandı` +
    `  |  Eklendi/Güncellendi: ${stats.processed}` +
    `  Elektronik değil: ${stats.noElec}` +
    `  Amazon/MMarkt yok: ${stats.noBig}` +
    `  Başka satıcı yok: ${stats.noOther}` +
    `  Süre: ${elapsed}dk`
  );
  console.log(`${line}\n`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
