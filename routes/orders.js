const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Tüm siparişleri getir (Admin)
router.get('/', (req, res) => {
  db.all(`
    SELECT o.*, GROUP_CONCAT(oi.product_name || ' x' || oi.quantity) as items
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Tek sipariş detayı
router.get('/:id', (req, res) => {
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
  const { customer_name, customer_phone, customer_email, customer_address, customer_city, note, items } = req.body;

  if (!customer_name || !customer_phone || !customer_address || !customer_city || !items?.length) {
    return res.status(400).json({ error: 'Eksik bilgi var' });
  }

  const total_price = items.reduce((s, i) => s + i.price * i.quantity, 0);

  db.run(`
    INSERT INTO orders (customer_name, customer_phone, customer_email, customer_address, customer_city, total_price, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [customer_name, customer_phone, customer_email, customer_address, customer_city, total_price, note],
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

// Sipariş durumu güncelle (Admin)
router.put('/:id/status', (req, res) => {
  const { status } = req.body;
  db.run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Durum güncellendi' });
  });
});

module.exports = router;