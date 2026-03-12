require('dotenv').config();
const puppeteer = require('puppeteer');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:GqkoaepmlWoBkUHWFilygxysXSnVweLJ@turntable.proxy.rlwy.net:34731/railway';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function scrapeAkakce(page, productName) {
  const searchUrl = `https://www.akakce.com/arama/?q=${encodeURIComponent(productName)}`;
  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);

    // İlk ürün linkini bul
    const productLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      for (const a of links) {
        const href = a.href || '';
        // Akakce ürün sayfaları genellikle şu formatta: /urun-adi-fiyati,12345.html
        if (href.includes('akakce.com') && href.match(/,\d+\.html/)) {
          return href;
        }
      }
      return null;
    });

    if (!productLink) {
      console.log(`    Ürün linki bulunamadı: ${productName.slice(0,40)}`);
      return [];
    }

    // Ürün sayfasına git
    await page.goto(productLink, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500);

    // İlk 3 satıcı fiyatını al
    const prices = await page.evaluate(() => {
      const results = [];
      // Fiyat listesi: her satıcı bir li elementi
      const items = document.querySelectorAll('ul.v_l li, .pr_l li, [class*="seller"] li, li[data-id]');
      items.forEach(item => {
        if (results.length >= 3) return;
        // Fiyatı bul
        const priceEl = item.querySelector('[class*="price"], [class*="pt_"], .fw_v8, b');
        const nameEl = item.querySelector('[class*="seller"], [class*="shop"], a, span');
        const linkEl = item.querySelector('a[href]');

        const priceText = priceEl ? priceEl.textContent.trim() : '';
        const priceMatch = priceText.match(/([\d.]+),(\d{2})/);
        if (priceMatch) {
          const price = parseFloat(priceMatch[1].replace(/\./g,'') + '.' + priceMatch[2]);
          results.push({
            seller: nameEl ? nameEl.textContent.trim().slice(0,50) : 'Satıcı',
            price,
            url: linkEl ? linkEl.href : window.location.href
          });
        }
      });

      // Fallback: sayfadaki tüm fiyat elementleri
      if (results.length === 0) {
        const allPrices = document.querySelectorAll('[class*="pt_"], [class*="price"], .fw_v8');
        allPrices.forEach(el => {
          if (results.length >= 3) return;
          const text = el.textContent.trim();
          const match = text.match(/([\d.]+),(\d{2})\s*TL/);
          if (match) {
            const price = parseFloat(match[1].replace(/\./g,'') + '.' + match[2]);
            if (price > 0) {
              results.push({ seller: 'Akakçe', price, url: window.location.href });
            }
          }
        });
      }

      return results;
    });

    return prices;
  } catch(e) {
    console.log(`    Hata (${productName.slice(0,30)}):`, e.message.slice(0,80));
    return [];
  }
}

async function savePrice(productId, seller, price, url) {
  const existing = await pool.query(
    'SELECT id FROM prices WHERE product_id = $1 AND platform = $2',
    [productId, seller]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      'UPDATE prices SET price = $1, url = $2, last_updated = NOW() WHERE product_id = $3 AND platform = $4',
      [price, url, productId, seller]
    );
  } else {
    await pool.query(
      'INSERT INTO prices (product_id, platform, price, url) VALUES ($1, $2, $3, $4)',
      [productId, seller, price, url]
    );
  }
}

async function run() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=tr-TR']
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });

  // Tüm ürünleri al
  const { rows: products } = await pool.query(
    'SELECT id, name FROM products ORDER BY id'
  );

  console.log(`${products.length} ürün için Akakçe fiyatları çekiliyor...\n`);

  let success = 0;
  let noPrice = 0;

  for (let i = 0; i < products.length; i++) {
    const { id, name } = products[i];
    process.stdout.write(`[${i+1}/${products.length}] ${name.slice(0,50)}... `);

    const prices = await scrapeAkakce(page, name);

    if (prices.length === 0) {
      console.log('fiyat yok');
      noPrice++;
    } else {
      for (const p of prices) {
        await savePrice(id, p.seller, p.price, p.url);
      }
      console.log(`${prices.length} fiyat: ${prices.map(p => p.price + '₺').join(', ')}`);
      success++;
    }

    // Rate limiting - her ürün arasında 2-3 saniye bekle
    await sleep(2000 + Math.random() * 1000);
  }

  await browser.close();
  await pool.end();

  console.log(`\nTamamlandı: ${success} ürün fiyat bulundu, ${noPrice} bulunamadı`);
}

run().catch(e => {
  console.error('Kritik hata:', e.message);
  process.exit(1);
});
