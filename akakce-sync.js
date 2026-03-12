/**
 * akakce-sync.js
 * Akakçe'den MediaMarkt / Amazon satan ürünleri çeker,
 * sonraki en ucuz satıcı fiyatıyla products tablosuna upsert eder.
 * Her 24 saatte bir server.js içindeki node-cron tarafından çalıştırılır.
 * Manuel çalıştırmak: node akakce-sync.js
 */

require('dotenv').config();
const puppeteer = require('puppeteer');
const db = require('./database/db');

// ────────────────────────────────────────────────────────────
// Konfigürasyon
// ────────────────────────────────────────────────────────────

const BIG_RETAILERS = ['mediamarkt', 'amazon'];

// Akakçe'de taranacak kategoriler → store kategorisi eşleşmesi
const CATEGORIES = [
  { url: 'https://www.akakce.com/elektronik/',           storeCategory: 'Elektronik' },
  { url: 'https://www.akakce.com/cep-telefonu/',         storeCategory: 'Elektronik' },
  { url: 'https://www.akakce.com/bilgisayar-urunleri/',  storeCategory: 'Elektronik' },
  { url: 'https://www.akakce.com/oyun-konsol/',          storeCategory: 'Elektronik' },
  { url: 'https://www.akakce.com/ev-ve-yasam/',          storeCategory: 'Ev'         },
  { url: 'https://www.akakce.com/spor-ve-outdoor/',      storeCategory: 'Spor'       },
  { url: 'https://www.akakce.com/kozmetik-ve-bakim/',    storeCategory: 'Kozmetik'   },
];

const MAX_PRODUCTS_PER_CATEGORY = 20;  // kategori başına max ürün
const DELAY_BETWEEN_PAGES  = 2000;     // ms — sayfalar arası bekleme
const DELAY_BETWEEN_CATS   = 4000;     // ms — kategoriler arası bekleme

// ────────────────────────────────────────────────────────────
// Yardımcı fonksiyonlar
// ────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isBigRetailer(name) {
  const lower = (name || '').toLowerCase();
  return BIG_RETAILERS.some(r => lower.includes(r));
}

function parsePrice(text) {
  if (!text) return null;
  // "1.299,99 TL" veya "1299.99" veya "1.299,99"
  const m = text.replace(/\s/g, '').match(/([\d.]+)[,](\d{2})/);
  if (m) return parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
  const m2 = text.replace(/\s/g, '').match(/[\d]+\.[\d]{2}/);
  if (m2) return parseFloat(m2[0]);
  const digits = text.replace(/[^\d]/g, '');
  return digits.length > 0 ? parseInt(digits) : null;
}

// ────────────────────────────────────────────────────────────
// Akakçe kategori sayfasından ürün linklerini topla
// ────────────────────────────────────────────────────────────

async function getProductLinks(page, categoryUrl) {
  try {
    await page.goto(categoryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(DELAY_BETWEEN_PAGES);

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href]'))
        .map(a => a.href)
        .filter(href => /akakce\.com\/[^?]+,\d+\.html/.test(href))
        .filter((v, i, arr) => arr.indexOf(v) === i); // unique
    });

    return links.slice(0, MAX_PRODUCTS_PER_CATEGORY);
  } catch (e) {
    console.error(`  [hata] Kategori listesi alınamadı: ${e.message.slice(0, 70)}`);
    return [];
  }
}

// ────────────────────────────────────────────────────────────
// Akakçe ürün sayfasından satıcı + fiyat listesini çek
// ────────────────────────────────────────────────────────────

async function scrapeProductPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(DELAY_BETWEEN_PAGES);

    const data = await page.evaluate(() => {
      // ── Ürün adı ──────────────────────────────────────────
      const nameEl = document.querySelector('h1[class*="v_h"], h1, .v_h');
      const name = nameEl ? nameEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // ── Resim ─────────────────────────────────────────────
      const imgEl = document.querySelector(
        'img.v_img, img[class*="product"], .swiper-slide img, img[itemprop="image"]'
      );
      const imageUrl = imgEl
        ? (imgEl.getAttribute('data-src') || imgEl.src || '')
        : '';

      // ── Marka ─────────────────────────────────────────────
      const brandEl = document.querySelector(
        '[itemprop="brand"], [class*="brand_"], .marka, [class*="marka"]'
      );
      const brand = brandEl ? brandEl.textContent.trim() : '';

      // ── Satıcı listesi ────────────────────────────────────
      const sellers = [];

      // Akakçe satıcı satırları için bilinen birkaç selector
      const rows = document.querySelectorAll(
        'ul.v_l > li, ul#vL > li, [class*="pl_v"] li, [class*="pr_l"] li, li[class*="v_li"]'
      );

      rows.forEach(li => {
        const priceEl = li.querySelector(
          '[class*="pt_v"], [class*="pt_"], span.fw_v8, strong, b'
        );
        const sellerEl = li.querySelector(
          '[class*="sh_v"], [class*="sh_"], [class*="merchant"], a[class*="v_"], span[class*="v_n"]'
        );

        const rawPrice = priceEl ? priceEl.textContent.trim() : '';
        const rawSeller = sellerEl ? sellerEl.textContent.trim() : '';

        const priceMatch = rawPrice.replace(/\s/g, '').match(/([\d.]+)[,](\d{2})/);
        if (priceMatch && rawSeller) {
          const price = parseFloat(
            priceMatch[1].replace(/\./g, '') + '.' + priceMatch[2]
          );
          if (price > 0) sellers.push({ seller: rawSeller.slice(0, 80), price });
        }
      });

      // Fallback: sayfada fiyat+satıcı içeren meta/JSON-LD varsa kullan
      if (sellers.length === 0) {
        const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
        for (const s of scripts) {
          try {
            const json = JSON.parse(s.textContent);
            const offers = json.offers || (json['@graph'] || []).flatMap(n => n.offers || []);
            (Array.isArray(offers) ? offers : [offers]).forEach(o => {
              if (o && o.price && o.seller) {
                sellers.push({
                  seller: (o.seller.name || o.seller || '').toString().slice(0, 80),
                  price: parseFloat(o.price)
                });
              }
            });
          } catch (_) {}
        }
      }

      return { name, imageUrl, brand, sellers };
    });

    return { ...data, akakceUrl: url };
  } catch (e) {
    console.error(`  [hata] Ürün sayfası: ${e.message.slice(0, 70)}`);
    return null;
  }
}

// ────────────────────────────────────────────────────────────
// Ürünü DB'ye upsert et
// ────────────────────────────────────────────────────────────

function upsertProduct(data, category) {
  return new Promise((resolve) => {
    const { name, imageUrl, brand, sellers, akakceUrl } = data;

    if (!name || sellers.length === 0) return resolve(null);

    const hasBigRetailer = sellers.some(s => isBigRetailer(s.seller));
    if (!hasBigRetailer) return resolve(null);

    // Büyük perakendeciler hariç, en ucuz satıcı
    const others = sellers
      .filter(s => !isBigRetailer(s.seller))
      .sort((a, b) => a.price - b.price);

    if (others.length === 0) return resolve(null);

    const targetPrice  = others[0].price;
    const targetSeller = others[0].seller;

    // Adla arama (PostgreSQL ILIKE)
    const shortName = name.slice(0, 50);
    db.get(
      `SELECT id FROM products WHERE name ILIKE $1 LIMIT 1`,
      [shortName + '%'],
      (err, existing) => {
        if (existing) {
          db.run(
            `UPDATE products
             SET tane_price = $1,
                 image_url  = COALESCE(NULLIF(image_url, ''), $2),
                 tane_url   = $3
             WHERE id = $4`,
            [targetPrice, imageUrl || null, akakceUrl, existing.id],
            () => {
              console.log(
                `  ↻ Güncellendi: ${name.slice(0, 45)} → ${targetPrice.toLocaleString('tr-TR')}₺`
              );
              resolve(existing.id);
            }
          );
        } else {
          db.run(
            `INSERT INTO products
               (name, image_url, description, category, brand, tane_price, tane_url, stock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 99)`,
            [
              name,
              imageUrl || null,
              `${name} — ${targetSeller} üzerinden en uygun fiyatla.`,
              category,
              brand || null,
              targetPrice,
              akakceUrl,
            ],
            function (err2) {
              if (!err2) {
                console.log(
                  `  + Eklendi:    ${name.slice(0, 45)} → ${targetPrice.toLocaleString('tr-TR')}₺  (${targetSeller.slice(0, 30)})`
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

// ────────────────────────────────────────────────────────────
// Ana çalıştırıcı
// ────────────────────────────────────────────────────────────

async function run() {
  const startedAt = new Date();
  console.log(`\n[${startedAt.toISOString()}] ── Akakçe sync başladı ──`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--lang=tr-TR',
      ],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' });

    let totalAdded = 0, totalUpdated = 0, totalSkipped = 0;

    for (const cat of CATEGORIES) {
      console.log(`\n▶ Kategori: ${cat.storeCategory} — ${cat.url}`);

      const links = await getProductLinks(page, cat.url);
      console.log(`  ${links.length} ürün linki alındı`);

      for (const link of links) {
        const productData = await scrapeProductPage(page, link);

        if (!productData || !productData.name || productData.sellers.length === 0) {
          totalSkipped++;
          continue;
        }

        const hasBig = productData.sellers.some(s => isBigRetailer(s.seller));
        if (!hasBig) {
          totalSkipped++;
          process.stdout.write('.');
          continue;
        }

        const result = await upsertProduct(productData, cat.storeCategory);
        if (result) totalAdded++;
        else totalSkipped++;

        await sleep(DELAY_BETWEEN_PAGES + Math.random() * 1000);
      }

      await sleep(DELAY_BETWEEN_CATS);
    }

    const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1);
    console.log(
      `\n[${new Date().toISOString()}] ── Sync tamamlandı ──` +
      `  İşlenen: ${totalAdded}  Atlanan: ${totalSkipped}  Süre: ${elapsed} dk`
    );
  } catch (e) {
    console.error(`[${new Date().toISOString()}] Sync kritik hata:`, e.message);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { run };

// Doğrudan çalıştırılırsa (node akakce-sync.js)
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}
