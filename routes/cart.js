const express = require('express');
const router = express.Router();
const db = require('../database/db');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  next();
}

// Sepeti getir
router.get('/', requireAuth, (req, res) => {
  db.all(`
    SELECT ci.id, ci.product_id, ci.quantity,
      p.name, p.image_url, p.tane_price, p.discount_price, p.stock
    FROM cart_items ci
    JOIN products p ON ci.product_id = p.id
    WHERE ci.user_id = ?
  `, [req.session.userId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Ürün ekle / güncelle
router.post('/', requireAuth, (req, res) => {
  const { product_id, quantity = 1 } = req.body;
  if (!product_id) return res.status(400).json({ error: 'Ürün ID gerekli' });

  db.run(
    `INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
    [req.session.userId, product_id, quantity],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: '✅ Sepete eklendi' });
    }
  );
});

// Miktar güncelle
router.put('/:productId', requireAuth, (req, res) => {
  const { quantity } = req.body;
  if (!quantity || quantity < 1) {
    db.run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?',
      [req.session.userId, req.params.productId], err => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: '✅ Ürün sepetten çıkarıldı' });
      });
    return;
  }
  db.run('UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?',
    [quantity, req.session.userId, req.params.productId], err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: '✅ Güncellendi' });
    });
});

// Ürün çıkar
router.delete('/:productId', requireAuth, (req, res) => {
  db.run('DELETE FROM cart_items WHERE user_id = ? AND product_id = ?',
    [req.session.userId, req.params.productId], err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: '✅ Sepetten çıkarıldı' });
    });
});

// Sepeti temizle
router.delete('/', requireAuth, (req, res) => {
  db.run('DELETE FROM cart_items WHERE user_id = ?', [req.session.userId], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Sepet temizlendi' });
  });
});

// Misafir sepetini sunucuya aktar (login sonrası)
router.post('/sync', requireAuth, (req, res) => {
  const { items } = req.body; // [{product_id, quantity}]
  if (!items?.length) return res.json({ message: 'Boş sepet' });

  const stmt = db.prepare(
    `INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = MAX(quantity, excluded.quantity)`
  );
  items.forEach(item => stmt.run(req.session.userId, item.product_id, item.quantity));
  stmt.finalize(() => res.json({ message: '✅ Sepet senkronize edildi' }));
});

module.exports = router;
