const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Ürüne ait tüm yorumları getir
router.get('/:productId', (req, res) => {
  db.all('SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC', [req.params.productId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Yorum ekle
router.post('/', (req, res) => {
  const { product_id, customer_name, rating, comment } = req.body;
  if (!product_id || !customer_name || !rating)
    return res.status(400).json({ error: 'Ürün, isim ve puan zorunlu' });

  const r = parseInt(rating);
  if (r < 1 || r > 5) return res.status(400).json({ error: 'Puan 1-5 arasında olmalı' });

  db.run('INSERT INTO reviews (product_id, customer_name, rating, comment) VALUES (?, ?, ?, ?)',
    [product_id, customer_name, r, comment || null], function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // Ürünün ortalama puanını güncelle
      db.get('SELECT AVG(CAST(rating AS REAL)) as avg, COUNT(*) as cnt FROM reviews WHERE product_id = ?',
        [product_id], (err, row) => {
          if (!err && row) {
            db.run('UPDATE products SET rating = ?, review_count = ? WHERE id = ?',
              [Math.round(row.avg * 10) / 10, row.cnt, product_id]);
          }
        });

      res.json({ id: this.lastID, message: '✅ Yorumunuz eklendi, teşekkürler!' });
    });
});

// Yorum sil (Admin)
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM reviews WHERE id = ?', [req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Yorum silindi' });
  });
});

module.exports = router;
