/**
 * /api/price-compare
 * SAFE, approval-based competitor price system.
 * NEVER touches product data — reads/writes only price-data.json.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const adminAuth = require('../middleware/adminAuth');

const DATA_FILE = path.join(__dirname, '..', 'public', 'price-data.json');

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return {}; }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Puppeteer + Stealth — CloudFlare bypass
const puppeteer = require('puppeteer-extra');
puppeteer.use(require('puppeteer-extra-plugin-stealth')());

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process']
    }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

// POST /api/price-compare/fetch
// Scrape Akakçe URL, extract Trendyol + Hepsiburada prices.
// Returns preview data — does NOT save anything.
router.post('/fetch', adminAuth, async (req, res) => {
  const { akakce_url } = req.body;
  if (!akakce_url || !akakce_url.includes('akakce')) {
    return res.status(400).json({ error: 'Geçerli bir Akakçe URL girin' });
  }

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
    await page.goto(akakce_url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Fiyat listesi DOM'a yüklenene kadar bekle (lazy-load)
    await page.waitForSelector('ul.pl_v9 li, ul[class*="pl_v"] li', { timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const result = await page.evaluate(() => {
      const sellers = [];

      // Akakçe doğrulanmış HTML yapısı: ul.pl_v9 > li (akakce-sync.js ile aynı)
      const rows = document.querySelectorAll('ul.pl_v9 > li, ul[class*="pl_v"] > li');

      rows.forEach(li => {
        // Satıcı adı: logo img[alt] veya span text
        const sellerSpan = li.querySelector('span.v_v8');
        let sellerName = '';
        if (sellerSpan) {
          const logo = sellerSpan.querySelector('img[alt]');
          sellerName = logo
            ? logo.alt.trim()
            : sellerSpan.textContent.trim().replace(/^\//, '').replace(/\s+/g, ' ');
        }

        // Fiyat: kampanya varsa onu al, yoksa normal
        const priceEl =
          li.querySelector('span.pt_v8.cmpgn_pt_v8') ||
          li.querySelector('span.pt_v8:not(.orig_pt_v8):not(.cmpgn_pt_v8)');
        const rawPrice = priceEl ? priceEl.textContent.replace(/\s/g, '') : '';

        const m = rawPrice.match(/([\d.]+)[,](\d{2})/);
        if (m && sellerName) {
          const price = parseFloat(m[1].replace(/\./g, '') + '.' + m[2]);
          if (price > 0) sellers.push({ seller: sellerName, price });
        }
      });

      // Platform eşleştirme
      const result = { trendyol: null, hepsiburada: null, all: [] };
      sellers.forEach(s => {
        const name = s.seller.toLowerCase();
        result.all.push(s);
        if (name.includes('trendyol') && (!result.trendyol || s.price < result.trendyol))
          result.trendyol = s.price;
        if ((name.includes('hepsiburada') || name.includes('hepsi')) && (!result.hepsiburada || s.price < result.hepsiburada))
          result.hepsiburada = s.price;
      });

      const productName = document.querySelector('h1[class*="v_h"], h1.v_h, h1')?.innerText?.trim() || '';
      return { sellers: result, name: productName, allSellers: result.all };
    });

    await page.close();

    if (!result.allSellers || !result.allSellers.length) {
      return res.status(422).json({
        error: 'Bu sayfada satıcı fiyatı bulunamadı.',
        hint: 'Akakçe ürün sayfasının gerçekten fiyat listesi içerdiğinden emin ol.'
      });
    }

    res.json({
      product_name: result.name,
      trendyol: result.sellers.trendyol || null,
      hepsiburada: result.sellers.hepsiburada || null,
      all_sellers: result.allSellers.slice(0, 10)
    });

  } catch (e) {
    if (page) await page.close().catch(() => {});
    console.error('price-compare/fetch hata:', e.message);
    res.status(500).json({ error: 'Sayfa açılamadı: ' + e.message.substring(0, 120) });
  }
});

// POST /api/price-compare/save-to-prices — rakip fiyatları prices tablosuna kaydet
router.post('/save-to-prices', adminAuth, (req, res) => {
  const { product_id, sellers } = req.body;
  if (!product_id || !Array.isArray(sellers)) return res.status(400).json({ error: 'product_id ve sellers gerekli' });
  const db = require('../database/db');
  // Mevcut fiyatları sil, yenilerini ekle
  db.run('DELETE FROM prices WHERE product_id = ?', [product_id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    let inserted = 0;
    const stmt = db.prepare('INSERT INTO prices (product_id, platform, price, url, last_updated) VALUES (?, ?, ?, ?, NOW())');
    sellers.forEach(s => {
      if (s.seller && s.price > 0) {
        stmt.run(product_id, s.seller, s.price, s.url || null);
        inserted++;
      }
    });
    stmt.finalize();
    res.json({ message: `✅ ${inserted} satıcı fiyatı kaydedildi`, inserted });
  });
});

// POST /api/price-compare/approve
// Called after admin reviews prices. Saves to price-data.json with approved:true.
router.post('/approve', adminAuth, (req, res) => {
  const { key, product_id, akakce_url, trendyol, hepsiburada } = req.body;
  if (!key) return res.status(400).json({ error: 'key (SKU veya ürün id) zorunlu' });

  try {
    const data = readData();
    // ONLY write approved prices — never touch product table
    data[key] = {
      product_id: product_id || null,
      akakce_url: akakce_url || '',
      trendyol: trendyol || null,
      hepsiburada: hepsiburada || null,
      approved: true,
      last_updated: new Date().toISOString().split('T')[0]
    };
    writeData(data);
    res.json({ ok: true, key });
  } catch (e) {
    console.error('price-compare/approve hata:', e.message);
    res.status(500).json({ error: 'Dosya yazılamadı' });
  }
});

// DELETE /api/price-compare/:key
// Remove an entry (reject or delete approved).
router.delete('/:key', adminAuth, (req, res) => {
  try {
    const data = readData();
    delete data[req.params.key];
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Silinemedi' });
  }
});

// GET /api/price-compare — list all approved entries (for admin overview)
router.get('/', adminAuth, (req, res) => {
  try { res.json(readData()); }
  catch (e) { res.json({}); }
});

module.exports = router;
