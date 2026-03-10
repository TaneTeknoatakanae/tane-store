const express = require('express');
const router = express.Router();
const db = require('../database/db');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  next();
}

// Favorileri getir
router.get('/', requireAuth, (req, res) => {
  db.all(`
    SELECT wi.product_id, p.name, p.image_url, p.tane_price, p.discount_price, p.rating, p.review_count
    FROM wishlist_items wi
    JOIN products p ON wi.product_id = p.id
    WHERE wi.user_id = ?
  `, [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Favoriye ekle
router.post('/:productId', requireAuth, (req, res) => {
  db.run(
    'INSERT OR IGNORE INTO wishlist_items (user_id, product_id) VALUES (?, ?)',
    [req.session.userId, req.params.productId],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: '✅ Favorilere eklendi' });
    }
  );
});

// Favoriden çıkar
router.delete('/:productId', requireAuth, (req, res) => {
  db.run(
    'DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?',
    [req.session.userId, req.params.productId],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: '✅ Favorilerden çıkarıldı' });
    }
  );
});

// Misafir favorilerini senkronize et
router.post('/sync', requireAuth, (req, res) => {
  const { ids } = req.body; // [product_id, ...]
  if (!ids?.length) return res.json({ message: 'Boş liste' });

  const stmt = db.prepare('INSERT OR IGNORE INTO wishlist_items (user_id, product_id) VALUES (?, ?)');
  ids.forEach(id => stmt.run(req.session.userId, id));
  stmt.finalize(() => res.json({ message: '✅ Favoriler senkronize edildi' }));
});

module.exports = router;
