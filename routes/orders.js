const express = require('express');
const router = express.Router();
const db = require('../database/db');
const adminAuth = require('../middleware/adminAuth');
const { audit } = adminAuth;

// Tüm siparişleri getir — admin only
router.get('/', adminAuth, (req, res) => {
  db.all(`
    SELECT o.*, STRING_AGG(oi.product_name || ' x' || oi.quantity::text, ',') as items
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Giriş yapmış kullanıcının siparişleri
router.get('/mine', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  // user_id ile eşleşen veya e-posta/telefon ile eşleşen siparişleri getir
  db.get('SELECT email, phone FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user) return res.json([]);
    db.all(`
      SELECT o.id, o.status, o.total_price, o.created_at,
        STRING_AGG(oi.product_name || ' x' || oi.quantity::text, ',') as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = ? OR o.customer_email = ? OR o.customer_phone = ?
      GROUP BY o.id ORDER BY o.created_at DESC
    `, [req.session.userId, user.email, user.phone], (err2, rows) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json(rows);
    });
  });
});

// Sipariş takip (PUBLIC — /:id'den önce tanımlanmalı)
router.get('/track/:id', (req, res) => {
  db.get(`SELECT id, status, total_price,
    customer_name, customer_city, shipping_carrier, shipping_code, created_at FROM orders WHERE id = ?`,
    [req.params.id], (err, order) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı. ID\'yi kontrol et.' });
      db.all('SELECT product_name, price, quantity FROM order_items WHERE order_id = ?',
        [req.params.id], (err, items) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ ...order, items });
        });
    });
});

// Tek sipariş detayı — admin only
router.get('/:id', adminAuth, (req, res) => {
  db.get('SELECT * FROM orders WHERE id = ?', [req.params.id], (err, order) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    db.all('SELECT * FROM order_items WHERE order_id = ?', [req.params.id], (err, items) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ...order, items });
    });
  });
});

// Yeni sipariş oluştur
router.post('/', (req, res) => {
  const { customer_name, customer_phone, customer_email, customer_address, customer_city,
    note, items } = req.body;

  if (!customer_name || !customer_phone || !customer_address || !customer_city || !items?.length) {
    return res.status(400).json({ error: 'Eksik bilgi var' });
  }

  const total_price = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const userId = req.session?.userId || null;

  db.run(`
    INSERT INTO orders (customer_name, customer_phone, customer_email, customer_address,
      customer_city, total_price, note, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [customer_name, customer_phone, customer_email || null, customer_address, customer_city,
    total_price, note || null, userId],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const orderId = this.lastID;

      const stmt = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
      items.forEach(item => stmt.run(orderId, item.product_id, item.product_name, item.price, item.quantity));
      stmt.finalize();

      res.json({ id: orderId, message: '✅ Sipariş alındı!' });
    });
});

// Sipariş durumu + kargo bilgisi güncelle — admin only
router.put('/:id/status', adminAuth, (req, res) => {
  const { status, shipping_carrier, shipping_code } = req.body;
  db.run(
    'UPDATE orders SET status = ?, shipping_carrier = COALESCE(?, shipping_carrier), shipping_code = COALESCE(?, shipping_code) WHERE id = ?',
    [status, shipping_carrier || null, shipping_code || null, req.params.id],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      audit(req, 'order.status_update', { id: req.params.id, status, shipping_code });
      res.json({ message: '✅ Güncellendi' });
    }
  );
});

// Sipariş iptali (Kullanıcı — sadece Beklemede)
router.put('/:id/cancel', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  db.get('SELECT status, user_id, customer_email FROM orders WHERE id = ?', [req.params.id], (err, order) => {
    if (err || !order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    db.get('SELECT email FROM users WHERE id = ?', [req.session.userId], (e2, user) => {
      const isOwner = order.user_id === req.session.userId || (user && order.customer_email === user.email);
      if (!isOwner) return res.status(403).json({ error: 'Yetkiniz yok' });
      if (order.status !== 'Beklemede') return res.status(400).json({ error: 'Sadece beklemedeki siparişler iptal edilebilir' });
      db.run('UPDATE orders SET status = ? WHERE id = ?', ['İptal', req.params.id], err3 => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({ message: '✅ Sipariş iptal edildi' });
      });
    });
  });
});

module.exports = router;
