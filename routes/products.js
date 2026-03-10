const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Tüm ürünleri getir
router.get('/', (req, res) => {
  const { category } = req.query;
  const where = category ? `WHERE p.category = $1` : '';
  const params = category ? [category] : [];
  db.all(`
    SELECT p.*,
      STRING_AGG(pr.platform, ',') as platforms,
      STRING_AGG(CAST(pr.price AS TEXT), ',') as platform_prices
    FROM products p
    LEFT JOIN prices pr ON p.id = pr.product_id
    ${where}
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Tek ürün getir
router.get('/:id', (req, res) => {
  db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, product) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    db.all('SELECT * FROM prices WHERE product_id = ? ORDER BY price ASC', [req.params.id], (err, prices) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ...product, prices });
    });
  });
});

// Yeni ürün ekle
router.post('/', (req, res) => {
  const { name, image_url, description, category, brand, sku, tane_price, discount_price, tane_url, stock } = req.body;
  if (!name) return res.status(400).json({ error: 'Ürün adı zorunlu' });

  db.run(`
    INSERT INTO products (name, image_url, description, category, brand, sku, tane_price, discount_price, tane_url, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [name, image_url || null, description || null, category || 'Genel', brand || null, sku || null,
    parseFloat(tane_price) || 0, discount_price ? parseFloat(discount_price) : null, tane_url || null, parseInt(stock) || 99],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, message: '✅ Ürün eklendi' });
    });
});

// Ürün güncelle
router.put('/:id', (req, res) => {
  const { name, image_url, description, category, brand, sku, tane_price, discount_price, tane_url, stock } = req.body;
  db.run(`
    UPDATE products SET name=?, image_url=?, description=?, category=?, brand=?, sku=?,
      tane_price=?, discount_price=?, tane_url=?, stock=?
    WHERE id=?
  `, [name, image_url || null, description || null, category || 'Genel', brand || null, sku || null,
    parseFloat(tane_price) || 0, discount_price ? parseFloat(discount_price) : null, tane_url || null,
    parseInt(stock) || 99, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: '✅ Ürün güncellendi' });
    });
});

// Ürün sil
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM prices WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM reviews WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Ürün silindi' });
  });
});

module.exports = router;
