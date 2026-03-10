/**
 * migrate-to-pg.js
 * SQLite veritabanındaki verileri PostgreSQL'e aktarır.
 * Kullanım: DATABASE_URL=... node migrate-to-pg.js
 */
require('dotenv').config();
const sqlite3 = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');

const SQLITE_PATH = path.join(__dirname, 'database', 'tane-store.db');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  let db;
  try {
    db = sqlite3(SQLITE_PATH, { readonly: true });
    console.log('✅ SQLite veritabanı açıldı');
  } catch (e) {
    console.error('❌ SQLite açılamadı:', e.message);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // --- products ---
    const products = db.prepare('SELECT * FROM products').all();
    console.log(`📦 ${products.length} ürün aktarılıyor...`);
    for (const p of products) {
      await client.query(`
        INSERT INTO products (name, image_url, description, category, brand, sku,
          tane_price, discount_price, tane_url, stock, rating, review_count, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT DO NOTHING
      `, [p.name, p.image_url, p.description, p.category, p.brand, p.sku,
          p.tane_price, p.discount_price, p.tane_url, p.stock ?? 99,
          p.rating ?? 0, p.review_count ?? 0, p.created_at]);
    }
    console.log('✅ Ürünler aktarıldı');

    // --- prices ---
    const prices = db.prepare('SELECT * FROM prices').all();
    if (prices.length) {
      console.log(`💰 ${prices.length} fiyat aktarılıyor...`);
      // map old product ids to new ones by name
      const { rows: pgProducts } = await client.query('SELECT id, name FROM products');
      const nameToId = {};
      pgProducts.forEach(r => { nameToId[r.name] = r.id; });
      const oldProducts = db.prepare('SELECT id, name FROM products').all();
      const oldIdToNew = {};
      oldProducts.forEach(r => { oldIdToNew[r.id] = nameToId[r.name]; });

      for (const pr of prices) {
        const newProductId = oldIdToNew[pr.product_id];
        if (!newProductId) continue;
        await client.query(`
          INSERT INTO prices (product_id, platform, price, url, last_updated)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING
        `, [newProductId, pr.platform, pr.price, pr.url, pr.last_updated]);
      }
      console.log('✅ Fiyatlar aktarıldı');
    }

    // --- coupons ---
    const coupons = db.prepare('SELECT * FROM coupons').all();
    if (coupons.length) {
      console.log(`🏷️  ${coupons.length} kupon aktarılıyor...`);
      for (const c of coupons) {
        await client.query(`
          INSERT INTO coupons (code, type, value, min_order, usage_limit, used_count, active, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code) DO NOTHING
        `, [c.code, c.type, c.value, c.min_order ?? 0, c.usage_limit,
            c.used_count ?? 0, c.active ?? 1, c.created_at]);
      }
      console.log('✅ Kuponlar aktarıldı');
    }

    console.log('\n🎉 Migrasyon tamamlandı!');
  } catch (e) {
    console.error('❌ Migrasyon hatası:', e.message);
  } finally {
    client.release();
    await pool.end();
    db.close();
  }
}

migrate();
