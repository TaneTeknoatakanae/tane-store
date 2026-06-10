const express = require('express');
const router = express.Router();
const db = require('../database/db');
const adminAuth = require('../middleware/adminAuth');
const { audit } = adminAuth;

const KEYS = { print: 'print_pricing', laser: 'laser_pricing' };

// GET /api/admin/settings/pricing/:type — fiyat config'i oku (print | laser)
router.get('/pricing/:type', adminAuth, (req, res) => {
  const key = KEYS[req.params.type];
  if (!key) return res.status(400).json({ error: 'Geçersiz tip' });
  db.get('SELECT value, updated_at FROM app_settings WHERE key = ?', [key], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Ayar bulunamadı' });
    try { res.json({ config: JSON.parse(row.value), updated_at: row.updated_at }); }
    catch (e) { res.status(500).json({ error: 'Ayar bozuk' }); }
  });
});

// PUT /api/admin/settings/pricing/:type — fiyat config'i kaydet
router.put('/pricing/:type', adminAuth, (req, res) => {
  const key = KEYS[req.params.type];
  if (!key) return res.status(400).json({ error: 'Geçersiz tip' });
  const cfg = req.body && req.body.config;
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return res.status(400).json({ error: 'Geçersiz veri' });
  }
  if (!cfg.materials || typeof cfg.materials !== 'object' || !Object.keys(cfg.materials).length) {
    return res.status(400).json({ error: 'En az bir materyal gerekli' });
  }
  const val = JSON.stringify(cfg);
  db.run(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, val],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      audit(req, 'update_pricing', { type: req.params.type });
      res.json({ ok: true });
    }
  );
});

module.exports = router;
