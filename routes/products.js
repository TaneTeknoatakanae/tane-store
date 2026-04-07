const express = require('express');
const router = express.Router();
const db = require('../database/db');
const adminAuth = require('../middleware/adminAuth');
const { audit } = adminAuth;

// Tüm ürünleri getir
router.get('/', (req, res) => {
  const { category, parent_slug, child_slug } = req.query;
  let where = '';
  const params = [];
  if (child_slug) {
    where = 'WHERE p.category_id = (SELECT id FROM categories WHERE slug = $1 AND parent_id IS NOT NULL)';
    params.push(child_slug);
  } else if (parent_slug) {
    where = 'WHERE p.category_id IN (SELECT id FROM categories WHERE parent_id = (SELECT id FROM categories WHERE slug = $1 AND parent_id IS NULL))';
    params.push(parent_slug);
  } else if (category) {
    where = 'WHERE p.category = $1';
    params.push(category);
  }
  db.all(`
    SELECT p.*,
      c.name AS category_name, c.slug AS category_slug,
      pc.id AS parent_cat_id, pc.name AS parent_cat_name, pc.slug AS parent_cat_slug,
      STRING_AGG(pr.platform, ',') as platforms,
      STRING_AGG(CAST(pr.price AS TEXT), ',') as platform_prices
    FROM products p
    LEFT JOIN prices pr ON p.id = pr.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    ${where}
    GROUP BY p.id, c.id, pc.id
    ORDER BY p.created_at DESC
  `, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Tek ürün getir
router.get('/:id', (req, res) => {
  db.get(`
    SELECT p.*,
      c.name AS category_name, c.slug AS category_slug,
      pc.name AS parent_cat_name, pc.slug AS parent_cat_slug
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE p.id = ?
  `, [req.params.id], (err, product) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    db.all('SELECT * FROM prices WHERE product_id = ? ORDER BY price ASC', [req.params.id], (err, prices) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ...product, prices });
    });
  });
});

// Yeni ürün ekle — admin only
router.post('/', adminAuth, (req, res) => {
  const { name, image_url, images, description, category, category_id, brand, sku, tane_price, discount_price, tane_url, stock } = req.body;
  if (!name) return res.status(400).json({ error: 'Ürün adı zorunlu' });

  db.run(`
    INSERT INTO products (name, image_url, images, description, category, category_id, brand, sku, tane_price, discount_price, tane_url, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [name, image_url || null, images || null, description || null, category || 'Genel', category_id ? parseInt(category_id) : null, brand || null, sku || null,
    parseFloat(tane_price) || 0, discount_price ? parseFloat(discount_price) : null, tane_url || null, parseInt(stock) || 99],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      audit(req, 'product.create', { name, id: this.lastID });
      res.json({ id: this.lastID, message: '✅ Ürün eklendi' });
    });
});

// Ürün güncelle — admin only
router.put('/:id', adminAuth, (req, res) => {
  const { name, image_url, images, description, category, category_id, brand, sku, tane_price, discount_price, tane_url, stock } = req.body;
  db.run(`
    UPDATE products SET name=?, image_url=?, images=?, description=?, category=?, category_id=?, brand=?, sku=?,
      tane_price=?, discount_price=?, tane_url=?, stock=?
    WHERE id=?
  `, [name, image_url || null, images || null, description || null, category || 'Genel', category_id ? parseInt(category_id) : null, brand || null, sku || null,
    parseFloat(tane_price) || 0, discount_price ? parseFloat(discount_price) : null, tane_url || null,
    parseInt(stock) || 99, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      audit(req, 'product.update', { id: req.params.id, name });
      res.json({ message: '✅ Ürün güncellendi' });
    });
});

// Ürün sil — admin only
router.delete('/:id', adminAuth, (req, res) => {
  db.run('DELETE FROM prices WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM reviews WHERE product_id = ?', [req.params.id]);
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    audit(req, 'product.delete', { id: req.params.id });
    res.json({ message: '✅ Ürün silindi' });
  });
});

module.exports = router;
