/**
 * akakce-sync.js
 *
 * Her 24 saatte bir https://www.akakce.com/fark-atan-fiyatlar/ sayfasını tarar.
 * Satıcısı Amazon Türkiye / Amazon Prime / Media Markt olan ürünlerde
 * sonraki en iyi (ikinci ucuz) fiyatı bulur ve sitemizde ilan açar/günceller.
 *
 * Manuel çalıştırma: node akakce-sync.js
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const db        = require('./database/db');

// ── Ayarlar ──────────────────────────────────────────────────────────────────

const DEALS_URL   = 'https://www.akakce.com/fark-atan-fiyatlar/';
const MAX_PAGES   = 5;          // fark-atan-fiyatlar kaç sayfa taransın
const DELAY_MS    = 2500;       // sayfa yükleme sonrası bekleme (ms)

const BIG_RETAILERS = ['amazon türkiye', 'amazon prime', 'amazon', 'media markt', 'mediamarkt'];

function isBig(name) {
  const n = (name || '').toLowerCase().trim();
  return BIG_RETAILERS.some(r => n.includes(r));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Tarayıcı başlatma ─────────────────────────────────────────────────────────

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--lang=tr-TR,tr',
    ],
  });
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
  return page;
}

// ── Adım 1: Fark-atan-fiyatlar listesinden ürün linklerini topla ──────────────

async function collectDealsLinks(page) {
  const allLinks = new Set();

  for (let p = 1; p <= MAX_PAGES; p++) {
    const url = p === 1 ? DEALS_URL : `${DEALS_URL}?page=${p}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(DELAY_MS);

      const pageLinks = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => a.href)
          .filter(h => /akakce\.com\/[^?#]+,\d+\.html/.test(h))
          .filter((v, i, arr) => arr.indexOf(v) === i);
      });

      if (pageLinks.length === 0) break; // boş sayfa → dur

      pageLinks.forEach(l => allLinks.add(l));
      console.log(`  Sayfa ${p}: ${pageLinks.length} link (+${allLinks.size} toplam)`);

      await sleep(1500);
    } catch (e) {
      console.error(`  Sayfa ${p} hata: ${e.message.slice(0, 70)}`);
      break;
    }
  }

  return [...allLinks];
}

// ── Adım 2: Ürün sayfasını tara ───────────────────────────────────────────────

async function scrapeProduct(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(DELAY_MS);

    return await page.evaluate((pageUrl) => {
      // ── Ürün adı ─────────────────────────────────────────────────────────
      const nameEl =
        document.querySelector('h1[class*="v_h"]') ||
        document.querySelector('h1.v_h') ||
        document.querySelector('h1');
      const name = nameEl ? nameEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Ana resim ─────────────────────────────────────────────────────────
      const imgEl =
        document.querySelector('img.v_img') ||
        document.querySelector('[class*="product-image"] img') ||
        document.querySelector('[class*="main"] img[src*="akakce"]') ||
        document.querySelector('img[itemprop="image"]');
      const imageUrl = imgEl
        ? (imgEl.getAttribute('data-src') || imgEl.getAttribute('data-lazy') || imgEl.src || '')
        : '';

      // ── Marka ─────────────────────────────────────────────────────────────
      const brandEl =
        document.querySelector('[itemprop="brand"]') ||
        document.querySelector('[class*="brand"]') ||
        document.querySelector('[class*="marka"]');
      const brand = brandEl ? brandEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Kısa açıklama / özellikler ────────────────────────────────────────
      const specEl =
        document.querySelector('[class*="spec"]') ||
        document.querySelector('[class*="ozellik"]') ||
        document.querySelector('[class*="desc"]');
      const description = specEl ? specEl.textContent.trim().replace(/\s+/g, ' ').slice(0, 500) : '';

      // ── Satıcı + fiyat listesi ────────────────────────────────────────────
      const sellers = [];

      // Akakçe satıcı satırları için geniş selector listesi
      const rows = [
        ...document.querySelectorAll('ul.v_l > li'),
        ...document.querySelectorAll('ul#vL > li'),
        ...document.querySelectorAll('[class*="pl_v"] > li'),
        ...document.querySelectorAll('[class*="pr_l"] > li'),
        ...document.querySelectorAll('li[class*="v_li"]'),
      ];

      // Tekrar eden satırları at (birden fazla selector aynı elementi döndürebilir)
      const seen = new Set();
      for (const li of rows) {
        if (seen.has(li)) continue;
        seen.add(li);

        // Fiyat elementleri (Akakçe sınıf isimleri: pt_v8, pt_v9 gibi versiyonlar kullanır)
        const priceEl =
          li.querySelector('[class*="pt_v"]') ||
          li.querySelector('[class*="pt_"]') ||
          li.querySelector('span.fw_v8') ||
          li.querySelector('strong') ||
          li.querySelector('b');

        // Satıcı adı elementleri
        const sellerEl =
          li.querySelector('[class*="sh_v"]') ||
          li.querySelector('[class*="sh_"]') ||
          li.querySelector('[class*="merchant"]') ||
          li.querySelector('a[class*="v_"]') ||
          li.querySelector('span[class*="v_n"]') ||
          li.querySelector('a.v_s') ||
          li.querySelector('a');

        // Satıcı URL'si
        const linkEl = li.querySelector('a[href*="akakce.com/rd"]') || li.querySelector('a[href]');

        const rawPrice  = priceEl  ? priceEl.textContent.trim()  : '';
        const rawSeller = sellerEl ? sellerEl.textContent.trim() : '';
        const sellerUrl = linkEl   ? linkEl.href                 : pageUrl;

        const m = rawPrice.replace(/\s/g, '').match(/([\d.]+)[,](\d{2})/);
        if (m && rawSeller) {
          const price = parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
          if (price > 0) {
            sellers.push({
              seller:    rawSeller.replace(/\s+/g, ' ').slice(0, 80),
              price,
              sellerUrl: sellerUrl.slice(0, 300),
            });
          }
        }
      }

      // Fallback: JSON-LD offers
      if (sellers.length === 0) {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const json = JSON.parse(s.textContent);
            const offers = [
              ...(json.offers ? (Array.isArray(json.offers) ? json.offers : [json.offers]) : []),
              ...((json['@graph'] || []).flatMap(n =>
                n.offers ? (Array.isArray(n.offers) ? n.offers : [n.offers]) : []
              )),
            ];
            for (const o of offers) {
              if (o && o.price) {
                sellers.push({
                  seller:    String(o.seller?.name || o.seller || 'Satıcı').slice(0, 80),
                  price:     parseFloat(o.price),
                  sellerUrl: o.url || pageUrl,
                });
              }
            }
          } catch (_) {}
        }
      }

      return { name, imageUrl, brand, description, sellers, akakceUrl: pageUrl };
    }, url);

  } catch (e) {
    console.error(`  [hata] ${url.slice(0, 60)}: ${e.message.slice(0, 60)}`);
    return null;
  }
}

// ── Adım 3: İkinci en iyi fiyatı bul ─────────────────────────────────────────

function findTargetPrice(sellers) {
  if (!sellers || sellers.length === 0) return null;

  // Fiyata göre artan sırala
  const sorted = [...sellers].sort((a, b) => a.price - b.price);

  // En az bir büyük perakendeci olmalı
  if (!sorted.some(s => isBig(s.seller))) return null;

  // Büyük perakendeciler dışındaki en ucuz satıcı
  const next = sorted.find(s => !isBig(s.seller));
  return next || null;
}

// ── Adım 4: DB'ye upsert ─────────────────────────────────────────────────────

function upsertProduct(data) {
  return new Promise((resolve) => {
    const { name, imageUrl, brand, description, akakceUrl, targetSeller } = data;
    const price = data.targetPrice;

    // İsimle var mı kontrol et (ilk 50 karakter ILIKE)
    db.get(
      `SELECT id FROM products WHERE name ILIKE $1 LIMIT 1`,
      [`${name.slice(0, 50)}%`],
      (err, existing) => {
        if (existing) {
          // Fiyat ve resmi güncelle
          db.run(
            `UPDATE products
             SET tane_price  = $1,
                 image_url   = COALESCE(NULLIF(image_url, ''), $2),
                 tane_url    = $3
             WHERE id = $4`,
            [price, imageUrl || null, akakceUrl, existing.id],
            () => {
              console.log(
                `  ↻ GÜNCELLENDİ : ${name.slice(0, 50).padEnd(52)} ${price.toLocaleString('tr-TR')}₺`
              );
              resolve(existing.id);
            }
          );
        } else {
          // Yeni ilan
          const desc =
            description ||
            `${name}${brand ? ' — ' + brand : ''} · ${targetSeller} hariç en uygun fiyat.`;

          db.run(
            `INSERT INTO products
               (name, image_url, description, category, brand, tane_price, tane_url, stock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 99)`,
            [name, imageUrl || null, desc.slice(0, 500), 'Elektronik', brand || null, price, akakceUrl],
            function (err2) {
              if (!err2) {
                console.log(
                  `  + EKLENDI     : ${name.slice(0, 50).padEnd(52)} ${price.toLocaleString('tr-TR')}₺  (${targetSeller.slice(0, 25)})`
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

// ── Ana akış ─────────────────────────────────────────────────────────────────

async function run() {
  const startedAt = new Date();
  console.log(`\n${'─'.repeat(65)}`);
  console.log(`[${startedAt.toISOString()}]  Akakçe fark-atan-fiyatlar sync başladı`);
  console.log(`${'─'.repeat(65)}`);

  let browser;
  let stats = { added: 0, updated: 0, skipped: 0, errors: 0 };

  try {
    browser = await launchBrowser();
    const page = await newPage(browser);

    // ── 1. Ürün linklerini topla ──────────────────────────────────────────
    console.log(`\n▶ Fark-atan-fiyatlar listesi toplanıyor…`);
    const links = await collectDealsLinks(page);
    console.log(`\n  Toplam ${links.length} ürün linki bulundu.\n`);

    if (links.length === 0) {
      console.log('  ⚠️  Link bulunamadı. Sayfa yapısı değişmiş olabilir.');
      return;
    }

    // ── 2. Her ürünü tara ─────────────────────────────────────────────────
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      process.stdout.write(`[${String(i + 1).padStart(3)}/${links.length}] `);

      const product = await scrapeProduct(page, link);

      if (!product || !product.name) {
        console.log(`atlandı (veri yok)`);
        stats.errors++;
        continue;
      }

      const target = findTargetPrice(product.sellers);

      if (!target) {
        process.stdout.write(`atlandı — `);
        const hasBig = product.sellers.some(s => isBig(s.seller));
        console.log(
          hasBig
            ? `büyük perakendeci var ama başka satıcı yok`
            : `büyük perakendeci yok`
        );
        stats.skipped++;
        continue;
      }

      // Upsert
      const result = await upsertProduct({
        name:         product.name,
        imageUrl:     product.imageUrl,
        brand:        product.brand,
        description:  product.description,
        akakceUrl:    link,
        targetPrice:  target.price,
        targetSeller: target.seller,
      });

      if (result) stats.added++;
      else        stats.errors++;

      // Rate-limit: 2–3.5 saniye arasında rastgele bekle
      await sleep(DELAY_MS + Math.random() * 1000);
    }

  } catch (e) {
    console.error(`\n[KRİTİK HATA] ${e.message}`);
    stats.errors++;
  } finally {
    if (browser) await browser.close();
  }

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
  console.log(`\n${'─'.repeat(65)}`);
  console.log(
    `[${new Date().toISOString()}]  Tamamlandı` +
    `  |  İşlendi: ${stats.added}  Atlandı: ${stats.skipped}  Hata: ${stats.errors}  Süre: ${elapsed} dk`
  );
  console.log(`${'─'.repeat(65)}\n`);
}

module.exports = { run };

if (require.main === module) {
  run().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}
