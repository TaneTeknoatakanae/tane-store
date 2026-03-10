const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  run(sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }
    if (!Array.isArray(params)) params = [];
    let pgSql = toPositional(sql);
    if (/^\s*INSERT/i.test(pgSql) && !/RETURNING/i.test(pgSql)) pgSql += ' RETURNING id';
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
  serialize(fn) { fn && fn(); },
  close() {}
};

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, image_url TEXT,
      description TEXT, category TEXT, tane_price REAL NOT NULL DEFAULT 0,
      tane_url TEXT, stock INTEGER DEFAULT 99,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS prices (
      id SERIAL PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform TEXT NOT NULL, price REAL, url TEXT, last_updated TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
      customer_email TEXT, customer_address TEXT NOT NULL, customer_city TEXT NOT NULL,
      total_price REAL NOT NULL, status TEXT DEFAULT 'Beklemede', note TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL, price REAL NOT NULL, quantity INTEGER NOT NULL
    )`);
    console.log('✅ PostgreSQL veritabanına bağlandı');
  } catch(e) {
    console.error('❌ DB hatası:', e.message);
    process.exit(1);
  }
}

initDB();
module.exports = db;


