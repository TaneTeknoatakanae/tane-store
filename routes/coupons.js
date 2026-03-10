const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Kupon doğrula (checkout'ta kullanılır)
router.post('/apply', (req, res) => {
  const { code, total } = req.body;
  if (!code) return res.status(400).json({ error: 'Kupon kodu gerekli' });

  db.get('SELECT * FROM coupons WHERE code = ? AND active = 1', [code.toUpperCase().trim()], (err, coupon) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!coupon) return res.status(404).json({ error: 'Geçersiz veya süresi dolmuş kupon kodu' });
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit)
      return res.status(400).json({ error: 'Bu kuponun kullanım limiti doldu' });
    if (total < coupon.min_order)
      return res.status(400).json({ error: `Bu kupon için minimum sepet tutarı ${coupon.min_order.toLocaleString('tr-TR')} ₺` });

    const discount = coupon.type === 'percent'
      ? Math.round(total * coupon.value / 100 * 100) / 100
      : Math.min(coupon.value, total);

    res.json({
      valid: true,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
      message: `✅ ${coupon.type === 'percent' ? '%' + coupon.value : coupon.value.toLocaleString('tr-TR') + ' ₺'} indirim uygulandı!`
    });
  });
});

// Admin: Tüm kuponları listele
router.get('/', (req, res) => {
  db.all('SELECT * FROM coupons ORDER BY created_at DESC', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Admin: Kupon oluştur
router.post('/', (req, res) => {
  const { code, type, value, min_order, usage_limit } = req.body;
  if (!code || !type || !value) return res.status(400).json({ error: 'Kod, tür ve değer zorunlu' });

  db.run('INSERT INTO coupons (code, type, value, min_order, usage_limit) VALUES (?, ?, ?, ?, ?)',
    [code.toUpperCase().trim(), type, parseFloat(value), parseFloat(min_order) || 0, usage_limit ? parseInt(usage_limit) : null],
    function(err) {
      if (err) {
        if (err.code === '23505') return res.status(400).json({ error: 'Bu kupon kodu zaten kullanılıyor' });
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, message: '✅ Kupon oluşturuldu' });
    });
});

// Admin: Kupon sil
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM coupons WHERE id = ?', [req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Kupon silindi' });
  });
});

// Admin: Kupon aktif/pasif
router.put('/:id', (req, res) => {
  const { active } = req.body;
  db.run('UPDATE coupons SET active = ? WHERE id = ?', [active ? 1 : 0, req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Güncellendi' });
  });
});

module.exports = router;
