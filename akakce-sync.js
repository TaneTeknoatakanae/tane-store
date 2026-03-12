/**
 * akakce-sync.js
 *
 * https://www.akakce.com/fark-atan-fiyatlar/ sayfasını tarar.
 * Elektronik kategorisindeki ürünlerde Amazon / Amazon Prime / Media Markt
 * satıcısı varsa; bu büyük perakendeciler hariç en ucuz satıcı fiyatıyla
 * ürünleri sitemize otomatik ekler / günceller.
 *
 * Manuel çalıştırma : node akakce-sync.js
 * Cron               : server.js içinde her gün 03:00'da tetiklenir
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const db        = require('./database/db');

// ─── Ayarlar ─────────────────────────────────────────────────────────────────

const DEALS_BASE_URL = 'https://www.akakce.com/fark-atan-fiyatlar/';
const MAX_PAGES      = 8;      // kaç sayfa taransın (her sayfa ~24 ürün)
const PAGE_DELAY_MS  = 2500;   // sayfa yüklemesi sonrası bekleme
const PRODUCT_DELAY_MS = 2000; // ürünler arası bekleme

// Büyük perakendeciler — case-insensitive içerir kontrolü
const BIG_RETAILERS = ['amazon türkiye', 'amazon prime', 'amazon', 'media markt', 'mediamarkt'];

// Elektronik kategori slug'ları (Akakçe URL'deki ilk path segmenti)
const ELECTRONICS_SLUGS = [
  'cep-telefonu', 'notebook', 'laptop', 'tablet', 'televizyon',
  'kulaklık', 'kulaklik', 'oyun-konsol', 'oyuncu', 'akilli-saat',
  'kamera', 'fotograf-makinesi', 'bilgisayar', 'monitor', 'fare',
  'klavye', 'yazici', 'ses-sistemi', 'hoparlor', 'hoparlör',
  'powerbank', 'sarj-cihazi', 'sarj', 'modem', 'router',
  'ag-urunleri', 'drone', 'projeksiyon', 'elektronik', 'smartwatch',
  'e-kitap', 'aksiyon-kamera', 'harddisk', 'ssd', 'ram', 'ekran-karti',
  'bluetooth', 'mikrofon', 'web-kamerasi', 'ups', 'playstation',
  'xbox', 'nintendo', 'airpods', 'aksesuar', 'saat',
];

// ─── Yardımcı fonksiyonlar ────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isBig(sellerName) {
  const n = (sellerName || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return BIG_RETAILERS.some(r => n.includes(r));
}

function isElectronics(url) {
  try {
    const slug = new URL(url).pathname.split('/')[1] || '';
    return ELECTRONICS_SLUGS.some(s => slug.includes(s));
  } catch {
    return false;
  }
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

// ─── Adım 1: Ürün URL'lerini topla ───────────────────────────────────────────

async function collectProductLinks(page) {
  const seen = new Set();

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    const url = pageNum === 1
      ? DEALS_BASE_URL
      : `${DEALS_BASE_URL}?p=${pageNum}`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(PAGE_DELAY_MS);

      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => /akakce\.com\/[^?#]+,\d+\.html/.test(h))
          .filter((v, i, arr) => arr.indexOf(v) === i)
      );

      if (links.length === 0) {
        console.log(`  Sayfa ${pageNum}: boş, duruyorum.`);
        break;
      }

      let newCount = 0;
      links.forEach(l => { if (!seen.has(l)) { seen.add(l); newCount++; } });

      console.log(
        `  Sayfa ${pageNum}: ${links.length} link  (+${newCount} yeni, toplam ${seen.size})`
      );

      if (newCount === 0) break; // aynı linkler tekrar geliyorsa dur
      await sleep(1000);
    } catch (e) {
      console.error(`  Sayfa ${pageNum} hata: ${e.message.slice(0, 70)}`);
      break;
    }
  }

  return [...seen];
}

// ─── Adım 2: Ürün sayfasını tara ─────────────────────────────────────────────

async function scrapeProductPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(PAGE_DELAY_MS);

    return await page.evaluate(() => {
      // ── Ürün adı ───────────────────────────────────────────────────────────
      const h1 = document.querySelector('h1[class*="v_h"], h1.v_h, h1');
      const name = h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Resim ─────────────────────────────────────────────────────────────
      const imgEl =
        document.querySelector('img.v_img') ||
        document.querySelector('img[itemprop="image"]') ||
        document.querySelector('[class*="product"] img') ||
        document.querySelector('[class*="main"] img');
      const imageUrl = imgEl
        ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy') || imgEl.src || '')
        : '';

      // ── Marka ─────────────────────────────────────────────────────────────
      const brandEl =
        document.querySelector('[itemprop="brand"]') ||
        document.querySelector('[class*="brand_"]') ||
        document.querySelector('[class*="marka"]');
      const brand = brandEl ? brandEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Açıklama / özellikler ─────────────────────────────────────────────
      const specEl =
        document.querySelector('[class*="spec"]') ||
        document.querySelector('[class*="ozellik"]') ||
        document.querySelector('[class*="desc"]') ||
        document.querySelector('[class*="features"]');
      const description = specEl
        ? specEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 500)
        : '';

      // ── Satıcı listesi ────────────────────────────────────────────────────
      // Gerçek yapı (debug'dan doğrulandı):
      //   ul.pl_v9 > li
      //     span.pt_v8          → fiyat (TL)
      //     span.pt_v8.orig_pt_v8 → orijinal fiyat (üstü çizili) — ATLIYORUZ
      //     span.pt_v8.cmpgn_pt_v8 → kampanya fiyatı (gerçek)
      //     span.v_v8           → satıcı adı (bazen "/" ile başlar)

      const sellers = [];
      const rows = document.querySelectorAll('ul.pl_v9 > li, ul[class*="pl_v"] > li');

      rows.forEach(li => {
        // Satıcı adı: büyük mağazalar (Amazon, MediaMarkt, Hepsiburada…) logo img kullanır,
        // küçük satıcılar text kullanır — her ikisini de kontrol ediyoruz.
        const sellerEl = li.querySelector('span.v_v8');
        let sellerName = '';
        if (sellerEl) {
          const img = sellerEl.querySelector('img[alt]');
          sellerName = img
            ? img.alt.trim()
            : sellerEl.textContent.trim().replace(/^\//, '').replace(/\s+/g, ' ');
        }

        // Efektif fiyat: kampanya fiyatı varsa o, yoksa normal pt_v8
        const campaignEl = li.querySelector('span.pt_v8.cmpgn_pt_v8');
        const regularEl  = li.querySelector('span.pt_v8:not(.orig_pt_v8):not(.cmpgn_pt_v8)');
        const priceEl    = campaignEl || regularEl;
        const priceText  = priceEl ? priceEl.textContent.trim() : '';

        const m = priceText.replace(/\s/g, '').match(/([\d.]+)[,](\d{2})/);
        if (m && sellerName) {
          const price = parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
          if (price > 0) sellers.push({ seller: sellerName.slice(0, 80), price });
        }
      });

      return { name, imageUrl, brand, description, sellers };
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

  // Listede en az bir büyük perakendeci olmalı
  if (!sorted.some(s => isBig(s.seller))) return null;

  // Büyük perakendeci olmayan en ucuz satıcı
  return sorted.find(s => !isBig(s.seller)) || null;
}

// ─── Adım 4: DB upsert ───────────────────────────────────────────────────────

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
              console.log(
                `  ↻ GÜNCELLENDİ  ${name.slice(0, 48).padEnd(50)} → ${targetPrice.toLocaleString('tr-TR')}₺`
              );
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
                console.log(
                  `  + EKLENDI      ${name.slice(0, 48).padEnd(50)} → ${targetPrice.toLocaleString('tr-TR')}₺  (${targetSeller.slice(0, 28)})`
                );
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
  const stats = { processed: 0, skipped: 0, noElec: 0, noBig: 0, errors: 0 };

  try {
    browser = await launchBrowser();
    const page = await makePage(browser);

    // 1) Tüm sayfalardaki ürün linklerini topla
    console.log('\n▶ Ürün linkleri toplanıyor…');
    const allLinks = await collectProductLinks(page);
    console.log(`\n  ${allLinks.length} toplam ürün linki.\n`);

    if (allLinks.length === 0) {
      console.log('  ⚠ Link bulunamadı, sayfa yapısı değişmiş olabilir.');
      return;
    }

    // 2) Her ürünü tara
    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      const prefix = `[${String(i + 1).padStart(3)}/${allLinks.length}]`;

      // Elektronik filtresi (URL slug'ından)
      if (!isElectronics(link)) {
        process.stdout.write(`${prefix} atlandı (elektronik değil)\n`);
        stats.noElec++;
        continue;
      }

      const product = await scrapeProductPage(page, link);

      if (!product || !product.name) {
        console.log(`${prefix} atlandı (veri alınamadı)`);
        stats.errors++;
        continue;
      }

      const target = findTarget(product.sellers);

      if (!target) {
        const hasBig = product.sellers.some(s => isBig(s.seller));
        console.log(`${prefix} atlandı — ${hasBig ? 'başka satıcı yok' : 'Amazon/MediaMarkt yok'}`);
        hasBig ? stats.skipped++ : stats.noBig++;
        continue;
      }

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
    `[${new Date().toISOString()}]  Tamamlandı  ` +
    `İşlendi:${stats.processed}  Elektronik değil:${stats.noElec}  ` +
    `Amazon/MMarkt yok:${stats.noBig}  Atlandı:${stats.skipped}  Süre:${elapsed}dk`
  );
  console.log(`${line}\n`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
