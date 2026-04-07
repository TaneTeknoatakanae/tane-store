const express = require('express');
const router = express.Router();
const db = require('../database/db');

// GET /api/categories — tüm kategoriler ağaç olarak
router.get('/', (req, res) => {
  db.all('SELECT id, name, slug, parent_id, sort_order FROM categories ORDER BY parent_id NULLS FIRST, sort_order, name', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const byId = {};
    const roots = [];
    (rows || []).forEach(r => { r.children = []; byId[r.id] = r; });
    (rows || []).forEach(r => {
      if (r.parent_id) {
        if (byId[r.parent_id]) byId[r.parent_id].children.push(r);
      } else {
        roots.push(r);
      }
    });
    res.json(roots);
  });
});

// GET /api/categories/flat — düz liste (admin için)
router.get('/flat', (req, res) => {
  db.all('SELECT id, name, slug, parent_id, sort_order FROM categories ORDER BY parent_id NULLS FIRST, sort_order, name', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// GET /api/categories/by-slug/:parent/:child? — slug'tan kategori bul
router.get('/by-slug/:parent/:child?', (req, res) => {
  const { parent, child } = req.params;
  db.get('SELECT * FROM categories WHERE slug = ? AND parent_id IS NULL', [parent], (err, p) => {
    if (err || !p) return res.status(404).json({ error: 'Kategori bulunamadı' });
    if (!child) return res.json({ parent: p, child: null });
    db.get('SELECT * FROM categories WHERE slug = ? AND parent_id = ?', [child, p.id], (err2, c) => {
      if (err2 || !c) return res.status(404).json({ error: 'Alt kategori bulunamadı' });
      res.json({ parent: p, child: c });
    });
  });
});

module.exports = router;
