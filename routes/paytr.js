const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const db = require('../database/db');

const MERCHANT_ID   = process.env.PAYTR_MERCHANT_ID;
const MERCHANT_KEY  = process.env.PAYTR_MERCHANT_KEY;
const MERCHANT_SALT = process.env.PAYTR_MERCHANT_SALT;
const SITE_URL      = 'https://tanetekno.com';
const CALLBACK_URL  = `${SITE_URL}/api/paytr/callback`;

// POST /api/paytr/token  — frontend calls this after order is created
// Body: { order_id }
router.post('/token', async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id eksik' });

  if (!MERCHANT_ID || !MERCHANT_KEY || !MERCHANT_SALT) {
    return res.status(500).json({ error: 'PayTR yapılandırması eksik (env vars)' });
  }

  // Fetch order + items
  db.get('SELECT * FROM orders WHERE id = ?', [order_id], (err, order) => {
    if (err || !order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    db.all('SELECT * FROM order_items WHERE order_id = ?', [order_id], async (err2, items) => {
      if (err2 || !items?.length) return res.status(400).json({ error: 'Sipariş kalemleri bulunamadı' });

      // Generate unique merchant_oid and save it
      const merchant_oid = 'TN' + order_id + '_' + Date.now();
      const user_ip = (req.headers['x-forwarded-for'] || req.ip || '127.0.0.1').split(',')[0].trim();
      const email = order.customer_email || 'musteri@tanetekno.com';
      const payment_amount = Math.round(order.total_price * 100); // kuruş

      // Save merchant_oid on order
      db.run('UPDATE orders SET merchant_oid = ?, payment_status = ? WHERE id = ?',
        [merchant_oid, 'pending', order_id], async function(err3) {
          if (err3) return res.status(500).json({ error: err3.message });

          // Build basket: [[name, unit_price_kuruş_str, qty_str], ...]
          const basket = items.map(i => [
            String(i.product_name).substring(0, 60),
            String(Math.round(i.price * 100)),
            String(i.quantity)
          ]);
          const user_basket = Buffer.from(JSON.stringify(basket)).toString('base64');

          const no_installment = 0;
          const max_installment = 0;
          const currency = 'TL';
          const test_mode = process.env.PAYTR_TEST_MODE === '1' ? 1 : 0;

          // PayTR HMAC-SHA256 token
          const hashStr = [
            MERCHANT_ID, user_ip, merchant_oid, email,
            payment_amount, user_basket, no_installment, max_installment,
            currency, test_mode, MERCHANT_SALT
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
            debug_on:          process.env.NODE_ENV !== 'production' ? '1' : '0',
            no_installment:    String(no_installment),
            max_installment:   String(max_installment),
            user_name:         order.customer_name,
            user_address:      order.customer_address,
            user_phone:        order.customer_phone,
            merchant_ok_url:   CALLBACK_URL,
            merchant_fail_url: CALLBACK_URL,
            currency,
            test_mode:         String(test_mode),
            lang:              'tr'
          });

          try {
            const resp = await axios.post(
              'https://www.paytr.com/odeme/api/get-token',
              params.toString(),
              { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
            );

            if (resp.data.status === 'success') {
              res.json({ token: resp.data.token, order_id });
            } else {
              // Rollback merchant_oid so user can retry
              db.run('UPDATE orders SET merchant_oid = NULL, payment_status = NULL WHERE id = ?', [order_id]);
              res.status(400).json({ error: resp.data.reason || 'PayTR token alınamadı' });
            }
          } catch (axiosErr) {
            db.run('UPDATE orders SET merchant_oid = NULL, payment_status = NULL WHERE id = ?', [order_id]);
            res.status(500).json({ error: 'PayTR bağlantı hatası: ' + axiosErr.message });
          }
        });
    });
  });
});

// POST /api/paytr/callback — PayTR sunucu tarafından çağrılır (sunucudan sunucuya)
// Respond EXACTLY "OK" on success, anything else = PayTR retries
router.post('/callback', express.urlencoded({ extended: false }), (req, res) => {
  const { merchant_oid, status, total_amount, hash } = req.body;

  if (!merchant_oid || !status || !total_amount || !hash) {
    console.error('[PayTR] Callback eksik alanlar:', req.body);
    return res.send('FAILED');
  }

  if (!MERCHANT_KEY || !MERCHANT_SALT) {
    console.error('[PayTR] MERCHANT_KEY/SALT eksik');
    return res.send('FAILED');
  }

  // Validate hash: base64(HMAC-SHA256(merchant_oid + salt + status + total_amount, key))
  const expectedHash = crypto.createHmac('sha256', MERCHANT_KEY)
    .update(merchant_oid + MERCHANT_SALT + status + total_amount)
    .digest('base64');

  if (hash !== expectedHash) {
    console.error('[PayTR] Hash doğrulama başarısız! merchant_oid:', merchant_oid);
    return res.send('FAILED');
  }

  const newStatus     = status === 'success' ? 'Ödendi' : 'Ödeme Başarısız';
  const payment_status = status === 'success' ? 'paid' : 'failed';

  db.run(
    'UPDATE orders SET status = ?, payment_status = ? WHERE merchant_oid = ?',
    [newStatus, payment_status, merchant_oid],
    function(err) {
      if (err) {
        console.error('[PayTR] Order güncelleme hatası:', err.message);
        return res.send('FAILED');
      }
      if (this.changes === 0) {
        console.error('[PayTR] merchant_oid bulunamadı:', merchant_oid);
      } else {
        console.log(`[PayTR] Ödeme ${status}: ${merchant_oid}`);
      }
      res.send('OK');
    }
  );
});

module.exports = router;
