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

// Reuse the Puppeteer browser from scrape-url route
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = require('puppeteer').launch({
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
    await page.goto(akakce_url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 3000));

    const result = await page.evaluate(() => {
      const sellers = {};

      // Akakçe price list — rows typically have seller name + price
      // Try multiple selectors that Akakçe has used
      const rows = document.querySelectorAll(
        '.result, .pl, [class*="product-list"] li, [class*="offerList"] li, ' +
        '.w-full.flex, [data-testid*="offer"], .ProductList__item'
      );

      rows.forEach(row => {
        const text = (row.innerText || '').toLowerCase();
        const priceMatch = (row.innerText || '').match(/[\d]{1,6}[.,]\d{2}|[\d]{2,6}/);
        if (!priceMatch) return;

        const priceStr = priceMatch[0].replace(',', '.').replace(/\./g, '');
        const price = parseFloat(priceStr);
        if (!price || price < 10) return;

        if (text.includes('trendyol')) {
          if (!sellers.trendyol || price < sellers.trendyol) sellers.trendyol = price;
        }
        if (text.includes('hepsiburada') || text.includes('hepsi')) {
          if (!sellers.hepsiburada || price < sellers.hepsiburada) sellers.hepsiburada = price;
        }
      });

      // Fallback: scan all text nodes on the page
      if (!sellers.trendyol || !sellers.hepsiburada) {
        const allText = document.body.innerText || '';
        const lines = allText.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].toLowerCase().trim();
          const nextLine = (lines[i + 1] || '').trim();
          const pm = nextLine.match(/[\d.,]+/);
          if (!pm) continue;
          const price = parseFloat(pm[0].replace(',', '.').replace(/\./g, ''));
          if (!price || price < 10 || price > 999999) continue;

          if (!sellers.trendyol && line.includes('trendyol')) sellers.trendyol = price;
          if (!sellers.hepsiburada && (line.includes('hepsiburada') || line.includes('hepsi'))) sellers.hepsiburada = price;
        }
      }

      // Product name from page title or h1
      const name = document.querySelector('h1')?.innerText?.trim() ||
                   document.title?.split('|')[0]?.trim() || '';

      return { sellers, name };
    });

    await page.close();

    if (!result.sellers.trendyol && !result.sellers.hepsiburada) {
      return res.status(422).json({
        error: 'Bu sayfada Trendyol veya Hepsiburada fiyatı bulunamadı.',
        hint: 'Akakçe ürün sayfasının gerçekten fiyat listesi içerdiğinden emin ol.'
      });
    }

    res.json({
      product_name: result.name,
      trendyol: result.sellers.trendyol || null,
      hepsiburada: result.sellers.hepsiburada || null,
    });

  } catch (e) {
    if (page) await page.close().catch(() => {});
    console.error('price-compare/fetch hata:', e.message);
    res.status(500).json({ error: 'Sayfa açılamadı: ' + e.message.substring(0, 120) });
  }
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
