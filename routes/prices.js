const express = require('express');
const router = express.Router();
const db = require('../database/db');
const axios = require('axios');
const cheerio = require('cheerio');

// Belirli bir ürünün tüm fiyatlarını getir
router.get('/:productId', (req, res) => {
  const { productId } = req.params;

  db.all(`
    SELECT * FROM prices 
    WHERE product_id = ? 
    ORDER BY price ASC
  `, [productId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Manuel fiyat ekle veya güncelle (Admin panelden)
router.post('/manual', (req, res) => {
  const { product_id, platform, price, url } = req.body;

  if (!product_id || !platform || !price) {
    return res.status(400).json({ error: 'Ürün ID, platform ve fiyat zorunlu' });
  }

  // Varsa güncelle, yoksa ekle
  db.get(
    'SELECT id FROM prices WHERE product_id = ? AND platform = ?',
    [product_id, platform],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row) {
        db.run(
          'UPDATE prices SET price = ?, url = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
          [price, url, row.id],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `✅ ${platform} fiyatı güncellendi` });
          }
        );
      } else {
        db.run(
          'INSERT INTO prices (product_id, platform, price, url) VALUES (?, ?, ?, ?)',
          [product_id, platform, price, url],
          (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: `✅ ${platform} fiyatı eklendi` });
          }
        );
      }
    }
  );
});

// Cimri'den fiyat çek
async function scrapeCimri(productName) {
  try {
    const searchUrl = `https://www.cimri.com/arama?q=${encodeURIComponent(productName)}`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    let price = null;
    let url = searchUrl;

    // Cimri fiyat elementini bul
    const priceEl = $('[class*="price"]').first().text().trim();
    if (priceEl) {
      const cleaned = priceEl.replace(/[^\d,]/g, '').replace(',', '.');
      price = parseFloat(cleaned);
    }

    return { platform: 'Cimri', price, url };
  } catch (err) {
    console.error('Cimri scrape hatası:', err.message);
    return { platform: 'Cimri', price: null, url: null };
  }
}

// Akakçe'den fiyat çek
async function scrapeAkakce(productName) {
  try {
    const searchUrl = `https://www.akakce.com/arama/?q=${encodeURIComponent(productName)}`;
    const { data } = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9'
      },
      timeout: 10000
    });

    const $ = cheerio.load(data);
    let price = null;
    let url = searchUrl;

    // Akakçe fiyat elementini bul
    const priceEl = $('[class*="price"], .pt_v8, .fw_v8').first().text().trim();
    if (priceEl) {
      const cleaned = priceEl.replace(/[^\d,]/g, '').replace(',', '.');
      price = parseFloat(cleaned);
    }

    return { platform: 'Akakçe', price, url };
  } catch (err) {
    console.error('Akakçe scrape hatası:', err.message);
    return { platform: 'Akakçe', price: null, url: null };
  }
}

// Otomatik fiyat çekme — bir ürün için tüm platformları tara
router.post('/scrape/:productId', async (req, res) => {
  const { productId } = req.params;

  db.get('SELECT * FROM products WHERE id = ?', [productId], async (err, product) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    res.json({ message: '🔍 Fiyat taraması başladı, lütfen bekleyin...' });

    // Paralel olarak her iki siteden fiyat çek
    const [cimri, akakce] = await Promise.all([
      scrapeCimri(product.name),
      scrapeAkakce(product.name)
    ]);

    const results = [cimri, akakce];

    // Sonuçları veritabanına kaydet
    results.forEach(result => {
      if (result.price) {
        db.get(
          'SELECT id FROM prices WHERE product_id = ? AND platform = ?',
          [productId, result.platform],
          (err, row) => {
            if (row) {
              db.run(
                'UPDATE prices SET price = ?, url = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
                [result.price, result.url, row.id]
              );
            } else {
              db.run(
                'INSERT INTO prices (product_id, platform, price, url) VALUES (?, ?, ?, ?)',
                [productId, result.platform, result.price, result.url]
              );
            }
          }
        );
      }
    });

    console.log(`✅ ${product.name} fiyatları güncellendi`);
  });
});

// En ucuz fiyat karşılaştırması — tüm ürünler için
router.get('/compare/all', (req, res) => {
  db.all(`
    SELECT 
      p.id,
      p.name,
      p.tane_price,
      p.image,
      p.category,
      MIN(pr.price) as min_competitor_price,
      pr.platform as cheapest_platform
    FROM products p
    LEFT JOIN prices pr ON p.id = pr.product_id
    GROUP BY p.id
    ORDER BY p.name
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    // Her ürün için kazanç hesapla
    const compared = rows.map(row => ({
      ...row,
      savings: row.min_competitor_price ? row.min_competitor_price - row.tane_price : null,
      is_cheapest: row.min_competitor_price ? row.tane_price <= row.min_competitor_price : true
    }));

    res.json(compared);
  });
});

module.exports = router;