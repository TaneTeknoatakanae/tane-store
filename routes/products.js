const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Tüm ürünleri getir
router.get('/', (req, res) => {
  db.all(`
    SELECT p.*, 
      GROUP_CONCAT(pr.platform) as platforms,
      GROUP_CONCAT(pr.price) as platform_prices
    FROM products p
    LEFT JOIN prices pr ON p.id = pr.product_id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `, (err, rows) => {
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
  const { name, image_url, description, category, tane_price, tane_url } = req.body;
  if (!name || !tane_price) return res.status(400).json({ error: 'Ürün adı ve fiyat zorunlu' });

  db.run(`
    INSERT INTO products (name, image_url, description, category, tane_price, tane_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, image_url, description, category, tane_price, tane_url], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: '✅ Ürün eklendi' });
  });
});

// Ürün güncelle
router.put('/:id', (req, res) => {
  const { name, image_url, description, category, tane_price, tane_url } = req.body;
  db.run(`
    UPDATE products SET name=?, image_url=?, description=?, category=?, tane_price=?, tane_url=?
    WHERE id=?
  `, [name, image_url, description, category, tane_price, tane_url, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Ürün güncellendi' });
  });
});

// Ürün sil
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM prices WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Ürün silindi' });
  });
});

module.exports = router;