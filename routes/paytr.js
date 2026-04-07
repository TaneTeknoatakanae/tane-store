const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const axios   = require('axios');
const db      = require('../database/db');

const MERCHANT_ID   = process.env.PAYTR_MERCHANT_ID;
const MERCHANT_KEY  = process.env.PAYTR_MERCHANT_KEY;
const MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT;
const CALLBACK_URL  = 'https://tanetekno.com/api/paytr/callback';

// ─────────────────────────────────────────────────────────────
// POST /api/paytr/create-payment
//
// Steps:
//   1. Create order row + order_items in DB (status = 'Beklemede', payment_status = 'pending')
//   2. Generate unique merchant_oid, save to order
//   3. Build PayTR token via HMAC-SHA256
//   4. Call PayTR API → get iframe token
//   5. Return { token, order_id } to frontend
// ─────────────────────────────────────────────────────────────
router.post('/create-payment', async (req, res) => {
  const {
    customer_name, customer_phone, customer_email,
    customer_address, customer_city, note, items
  } = req.body;

  // ── 1. Validate input ──────────────────────────────────────
  if (!customer_name || !customer_phone || !customer_address || !customer_city) {
    return res.status(400).json({ error: 'Eksik bilgi: ad, telefon, adres ve şehir zorunlu' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Sepet boş' });
  }
  if (!MERCHANT_ID || !MERCHANT_KEY || !MERCHANT_SALT) {
    console.error('[PayTR] Env vars eksik: PAYTR_MERCHANT_ID / KEY / SALT');
    return res.status(500).json({ error: 'Ödeme sistemi yapılandırılmamış' });
  }

  const total_price = items.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
  const userId      = req.session?.userId || null;

  console.log(`[PayTR] Sipariş oluşturuluyor — müşteri: ${customer_name}, toplam: ${total_price} ₺`);

  // ── 2. Create order in DB ──────────────────────────────────
  db.run(`
    INSERT INTO orders
      (customer_name, customer_phone, customer_email, customer_address,
       customer_city, total_price, note, user_id, status, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Beklemede', 'pending')
  `,
  [customer_name, customer_phone, customer_email || null,
   customer_address, customer_city, total_price, note || null, userId],
  function (err) {
    if (err) {
      console.error('[PayTR] Sipariş DB hatası:', err.message);
      return res.status(500).json({ error: 'Sipariş kaydedilemedi: ' + err.message });
    }
    const orderId = this.lastID;
    console.log(`[PayTR] Sipariş oluşturuldu — id: ${orderId}`);

    // ── 3. Insert order_items ──────────────────────────────
    const stmt = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);
    items.forEach(i => stmt.run(orderId, i.product_id, i.product_name, i.price, i.quantity));
    stmt.finalize();

    // ── 4. Generate merchant_oid and get PayTR token ───────
    const merchant_oid = `TN${orderId}T${Date.now()}`;
    const user_ip      = (req.headers['x-forwarded-for'] || req.ip || '127.0.0.1')
                          .split(',')[0].trim();
    const email         = customer_email || 'musteri@tanetekno.com';
    const payment_amount = Math.round(total_price * 100); // kuruş (integer)

    // Save merchant_oid to order
    db.run('UPDATE orders SET merchant_oid = ? WHERE id = ?', [merchant_oid, orderId],
      async function (err2) {
        if (err2) {
          console.error('[PayTR] merchant_oid kaydedilemedi:', err2.message);
          return res.status(500).json({ error: 'merchant_oid kaydedilemedi' });
        }

        // Build basket: [[name, unit_price_kuruş, qty], ...]  — PayTR expects strings
        const basket = items.map(i => [
          String(i.product_name).substring(0, 60),
          String(Math.round(Number(i.price) * 100)),
          String(Number(i.quantity))
        ]);
        const user_basket    = Buffer.from(JSON.stringify(basket)).toString('base64');
        const no_installment = 0;
        const max_installment = 0;
        const currency       = 'TL';
        const test_mode      = process.env.PAYTR_TEST_MODE === '1' ? 1 : 0;

        // HMAC-SHA256 token string (order matters — must match PayTR spec exactly)
        const hashStr = [
          MERCHANT_ID, user_ip, merchant_oid, email,
          payment_amount, user_basket,
          no_installment, max_installment,
          currency, test_mode,
          MERCHANT_SALT
        ].join('');
        const paytr_token = crypto.createHmac('sha256', MERCHANT_KEY)
          .update(hashStr).digest('base64');

        const params = new URLSearchParams({
          merchant_id:       MERCHANT_ID,
          user_ip,
          merchant_oid,
          email,
          payment_amount:    String(payment_amount),
          paytr_token,
          user_basket,
          debug_on:          test_mode === 1 ? '1' : '0',
          no_installment:    String(no_installment),
          max_installment:   String(max_installment),
          user_name:         customer_name,
          user_address:      customer_address,
          user_phone:        customer_phone,
          merchant_ok_url:   CALLBACK_URL,
          merchant_fail_url: CALLBACK_URL,
          currency,
          test_mode:         String(test_mode),
          lang:              'tr'
        });

        console.log('[PayTR] Token isteği gönderiliyor — merchant_oid:', merchant_oid,
          '| amount:', payment_amount, 'kuruş | test_mode:', test_mode);

        try {
          const resp = await axios.post(
            'https://www.paytr.com/odeme/api/get-token',
            params.toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
          );

          console.log('[PayTR] API yanıtı:', resp.data);

          if (resp.data.status === 'success') {
            return res.json({ token: resp.data.token, order_id: orderId });
          }

          // Token failed — mark order as failed so admin can see it
          db.run("UPDATE orders SET payment_status = 'token_failed' WHERE id = ?", [orderId]);
          console.error('[PayTR] Token alınamadı:', resp.data.reason);
          return res.status(400).json({ error: resp.data.reason || 'PayTR token alınamadı' });

        } catch (axiosErr) {
          db.run("UPDATE orders SET payment_status = 'token_failed' WHERE id = ?", [orderId]);
          console.error('[PayTR] Bağlantı hatası:', axiosErr.message);
          return res.status(500).json({ error: 'PayTR bağlantı hatası: ' + axiosErr.message });
        }
      });
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/paytr/callback
//
// Called server-to-server by PayTR after payment.
// MUST respond exactly "OK" — anything else causes PayTR to retry.
// ─────────────────────────────────────────────────────────────
router.post('/callback', express.urlencoded({ extended: false }), (req, res) => {
  const { merchant_oid, status, total_amount, hash } = req.body;

  console.log('[PayTR] Callback alındı:', { merchant_oid, status, total_amount });

  if (!merchant_oid || !status || !total_amount || !hash) {
    console.error('[PayTR] Callback eksik alan:', req.body);
    return res.send('FAILED');
  }
  if (!MERCHANT_KEY || !MERCHANT_SALT) {
    console.error('[PayTR] MERCHANT_KEY veya SALT eksik');
    return res.send('FAILED');
  }

  // Validate: base64(HMAC-SHA256(merchant_oid + salt + status + total_amount, key))
  const expectedHash = crypto.createHmac('sha256', MERCHANT_KEY)
    .update(merchant_oid + MERCHANT_SALT + status + total_amount)
    .digest('base64');

  if (hash !== expectedHash) {
    console.error('[PayTR] Hash eşleşmedi — olası sahte callback! merchant_oid:', merchant_oid);
    return res.send('FAILED');
  }

  const newStatus      = status === 'success' ? 'Ödendi' : 'Ödeme Başarısız';
  const payment_status = status === 'success' ? 'paid' : 'failed';

  db.run(
    'UPDATE orders SET status = ?, payment_status = ? WHERE merchant_oid = ?',
    [newStatus, payment_status, merchant_oid],
    function (err) {
      if (err) {
        console.error('[PayTR] Order güncelleme hatası:', err.message);
        return res.send('FAILED');
      }
      if (this.changes === 0) {
        console.error('[PayTR] merchant_oid bulunamadı:', merchant_oid);
      } else {
        console.log(`[PayTR] Ödeme sonucu kaydedildi — ${merchant_oid}: ${status} → ${newStatus}`);
      }
      res.send('OK'); // PayTR bu yanıtı bekliyor
    }
  );
});

module.exports = router;
