const express = require('express');
const router = express.Router();
const db = require('../database/db');
const adminAuth = require('../middleware/adminAuth');

// All analytics routes are admin-only
router.use(adminAuth);

// Summary stats
router.get('/summary', (req, res) => {
  db.get(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day') as today_views,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as week_views,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as month_views
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
    SELECT DATE(created_at AT TIME ZONE 'Europe/Istanbul') as date, COUNT(*) as views
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
    SELECT page, COUNT(*) as views
    FROM pageviews
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY page ORDER BY views DESC LIMIT 10
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
