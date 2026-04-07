const express = require('express');
const router = express.Router();
const db = require('../database/db');
const adminAuth = require('../middleware/adminAuth');

router.use(adminAuth);

// Summary stats — includes unique visitor counts
router.get('/summary', (req, res) => {
  db.get(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') as today_views,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as week_views,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as month_views,
      COUNT(DISTINCT ip_hash) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') as today_unique,
      COUNT(DISTINCT ip_hash) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as week_unique,
      COUNT(DISTINCT ip_hash) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as month_unique
    FROM pageviews
  `, [], (err, views) => {
    db.get(`
      SELECT
        COALESCE(SUM(total_price) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day'), 0) as today_rev,
        COALESCE(SUM(total_price) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0) as week_rev,
        COALESCE(SUM(total_price) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) as month_rev,
        COUNT(*) FILTER (WHERE status = 'Beklemede') as pending,
        COUNT(*) as total_orders
      FROM orders
    `, [], (err2, ord) => {
      db.get(`SELECT COUNT(*) as total FROM products`, [], (err3, prods) => {
        db.get(`SELECT COUNT(*) as total FROM users`, [], (err4, users) => {
          res.json({
            today_views: views?.today_views || 0,
            week_views: views?.week_views || 0,
            month_views: views?.month_views || 0,
            today_unique: views?.today_unique || 0,
            week_unique: views?.week_unique || 0,
            month_unique: views?.month_unique || 0,
            today_rev: ord?.today_rev || 0,
            week_rev: ord?.week_rev || 0,
            month_rev: ord?.month_rev || 0,
            pending: ord?.pending || 0,
            total_orders: ord?.total_orders || 0,
            total_products: prods?.total || 0,
            total_customers: users?.total || 0
          });
        });
      });
    });
  });
});

// Daily data (last 30 days)
router.get('/daily', (req, res) => {
  db.all(`
    SELECT DATE(created_at AT TIME ZONE 'Europe/Istanbul') as date,
           COUNT(*) as views,
           COUNT(DISTINCT ip_hash) as unique_visitors
    FROM pageviews
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(created_at AT TIME ZONE 'Europe/Istanbul')
    ORDER BY date ASC
  `, [], (err, viewRows) => {
    db.all(`
      SELECT DATE(created_at AT TIME ZONE 'Europe/Istanbul') as date,
             SUM(total_price) as revenue, COUNT(*) as orders
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at AT TIME ZONE 'Europe/Istanbul')
      ORDER BY date ASC
    `, [], (err2, revRows) => {
      res.json({ views: viewRows || [], revenue: revRows || [] });
    });
  });
});

// Top pages
router.get('/pages', (req, res) => {
  db.all(`
    SELECT page, COUNT(*) as views, COUNT(DISTINCT ip_hash) as unique_visitors
    FROM pageviews
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY page ORDER BY views DESC LIMIT 10
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Traffic sources — classify referrer into buckets
router.get('/traffic-sources', (req, res) => {
  db.all(`
    SELECT
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN 'Direkt'
        WHEN referrer LIKE '%google.%' OR referrer LIKE '%bing.%' OR referrer LIKE '%yahoo.%' OR referrer LIKE '%yandex.%' THEN 'Arama Motoru'
        WHEN referrer LIKE '%facebook.%' OR referrer LIKE '%instagram.%' OR referrer LIKE '%twitter.%' OR referrer LIKE '%t.co%' OR referrer LIKE '%tiktok.%' THEN 'Sosyal Medya'
        WHEN referrer LIKE '%tanetekno.com%' THEN 'Dahili'
        ELSE 'Diğer'
      END as source,
      COUNT(*) as views,
      COUNT(DISTINCT ip_hash) as unique_visitors
    FROM pageviews
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY source
    ORDER BY views DESC
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Top viewed products (by product page visits)
router.get('/top-viewed-products', (req, res) => {
  db.all(`
    SELECT p.id, p.name, p.image_url, p.tane_price, p.discount_price,
           COUNT(*) as views,
           COUNT(DISTINCT pv.ip_hash) as unique_visitors
    FROM pageviews pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id IS NOT NULL
      AND pv.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY p.id, p.name, p.image_url, p.tane_price, p.discount_price
    ORDER BY views DESC
    LIMIT 10
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Top selling products
router.get('/top-products', (req, res) => {
  db.all(`
    SELECT oi.product_name, SUM(oi.quantity) as sold, SUM(oi.price * oi.quantity) as revenue
    FROM order_items oi
    GROUP BY oi.product_name
    ORDER BY sold DESC LIMIT 5
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Yıllık ve genel toplam (yearly + all-time)
router.get('/yearly', (req, res) => {
  db.get(`
    SELECT
      COUNT(*)                                              AS year_views,
      COUNT(DISTINCT ip_hash)                               AS year_unique
    FROM pageviews
    WHERE created_at >= NOW() - INTERVAL '365 days'
  `, [], (e1, pv) => {
    db.get(`
      SELECT
        COALESCE(SUM(total_price), 0) AS year_rev,
        COUNT(*)                       AS year_orders
      FROM orders
      WHERE created_at >= NOW() - INTERVAL '365 days'
    `, [], (e2, ord) => {
      res.json({
        year_views:  pv?.year_views  || 0,
        year_unique: pv?.year_unique || 0,
        year_rev:    ord?.year_rev   || 0,
        year_orders: ord?.year_orders|| 0
      });
    });
  });
});

// En çok satan kategoriler — order_items'i products'a join ederek
router.get('/top-categories', (req, res) => {
  db.all(`
    SELECT
      COALESCE(NULLIF(p.category, ''), 'Diğer') AS category,
      SUM(oi.quantity)                          AS sold,
      SUM(oi.price * oi.quantity)               AS revenue
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders   o ON o.id = oi.order_id
    WHERE o.created_at >= NOW() - INTERVAL '90 days'
    GROUP BY category
    ORDER BY revenue DESC
    LIMIT 8
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// Device breakdown
router.get('/devices', (req, res) => {
  db.all(`
    SELECT device, COUNT(*) as count FROM pageviews
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY device
  `, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

module.exports = router;
