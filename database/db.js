require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ? → $1, $2, $3... dönüştürücü
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// SQLite3 API uyumlu wrapper
const db = {
  run(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    if (!Array.isArray(params)) params = [];
    let pgSql = toPositional(sql);
    if (/^\s*INSERT/i.test(sql) && !/RETURNING/i.test(pgSql)) {
      pgSql += ' RETURNING id';
    }
    pool.query(pgSql, params)
      .then(r => cb && cb.call({ lastID: r.rows[0]?.id ?? null, changes: r.rowCount }, null))
      .catch(err => cb && cb.call({ lastID: null, changes: 0 }, err));
  },

  get(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    if (!Array.isArray(params)) params = [];
    pool.query(toPositional(sql), params)
      .then(r => cb(null, r.rows[0]))
      .catch(err => cb(err));
  },

  all(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    if (!Array.isArray(params)) params = [];
    pool.query(toPositional(sql), params)
      .then(r => cb(null, r.rows))
      .catch(err => cb(err));
  },

  prepare(sql) {
    const pending = [];
    return {
      run(...args) { pending.push(args); },
      finalize(cb) {
        Promise.all(pending.map(p => {
          let i = 0;
          const s = sql.replace(/\?/g, () => `$${++i}`);
          const pgSql = /^\s*INSERT/i.test(s) && !/RETURNING/i.test(s) ? s + ' RETURNING id' : s;
          return pool.query(pgSql, p);
        }))
          .then(() => cb && cb())
          .catch(err => cb && cb(err));
      }
    };
  },

  serialize(fn) { fn && fn(); },
  close() {}
};

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, image_url TEXT, description TEXT,
      category TEXT, brand TEXT, sku TEXT, tane_price REAL NOT NULL DEFAULT 0,
      discount_price REAL, tane_url TEXT, stock INTEGER DEFAULT 99,
      rating REAL DEFAULT 0, review_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS prices (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform TEXT NOT NULL, price REAL, url TEXT, last_updated TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
      customer_email TEXT, customer_address TEXT NOT NULL, customer_city TEXT NOT NULL,
      total_price REAL NOT NULL, coupon_code TEXT, discount_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Beklemede', note TEXT, user_id INTEGER,
      shipping_carrier TEXT, shipping_code TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL, price REAL NOT NULL, quantity INTEGER NOT NULL
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL, customer_name TEXT NOT NULL,
      rating INTEGER NOT NULL, comment TEXT, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, type TEXT NOT NULL,
      value REAL NOT NULL, min_order REAL DEFAULT 0, usage_limit INTEGER,
      used_count INTEGER DEFAULT 0, active INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, phone TEXT, address TEXT, city TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS cart_items (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1, UNIQUE(user_id, product_id)
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS wishlist_items (
      id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      UNIQUE(user_id, product_id)
    )`);

    console.log('✅ PostgreSQL veritabanına bağlandı');
  } catch (e) {
    console.error('❌ DB init hatası:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

initDB();
module.exports = db;
