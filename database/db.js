require('dotenv').config();
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
  prepare(sql) {
    const pending = [];
    return {
      run(...args) {
        pending.push(args);
      },
      finalize() {
        pending.forEach(params => {
          let i = 0;
          let final = sql.replace(/\?/g, () => `$${++i}`);
          if (/^\s*INSERT/i.test(final) && !/RETURNING/i.test(final)) final += ' RETURNING id';
          pool.query(final, params).catch(e => console.error('prepare error:', e.message));
        });
      }
    };
  },
  serialize(fn) { fn && fn(); },
  close() {}
};

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      category TEXT,
      brand TEXT,
      sku TEXT,
      tane_price REAL NOT NULL DEFAULT 0,
      discount_price REAL,
      tane_url TEXT,
      stock INTEGER DEFAULT 99,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    // Var olan tabloya eksik sütunları ekle (idempotent)
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_price REAL`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT`);

    await pool.query(`CREATE TABLE IF NOT EXISTS prices (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      price REAL,
      url TEXT,
      last_updated TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      city TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      customer_address TEXT NOT NULL,
      customer_city TEXT NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'Beklemede',
      note TEXT,
      coupon_code TEXT,
      discount_amount REAL DEFAULT 0,
      shipping_carrier TEXT,
      shipping_code TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      author TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'percent',
      discount_value REAL NOT NULL,
      min_order REAL DEFAULT 0,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS cart_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, product_id)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS wishlist_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(user_id, product_id)
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS pageviews (
      id SERIAL PRIMARY KEY,
      page TEXT NOT NULL,
      referrer TEXT,
      device TEXT,
      ip_hash TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    await pool.query(`CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      details TEXT,
      ip TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`ALTER TABLE pageviews ADD COLUMN IF NOT EXISTS product_id INTEGER`);
    // orders — add every column that might be missing on existing DBs
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS note TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_carrier TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_code TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_oid TEXT`);
    await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending'`);
    // unique index on merchant_oid — safe to run repeatedly
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS orders_merchant_oid_idx ON orders(merchant_oid) WHERE merchant_oid IS NOT NULL`);

    // ── Hiyerarşik kategori sistemi ─────────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories(parent_id)`);
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL`);

    // İlk kez seed et — sadece tablo boşsa
    const seedCheck = await pool.query('SELECT COUNT(*)::int AS c FROM categories');
    if (seedCheck.rows[0].c === 0) {
      const tree = [
        { name: 'Bilgisayar',   slug: 'bilgisayar',   children: [
          { name: 'Laptop',                slug: 'laptop' },
          { name: 'Oyuncu Bilgisayarı',    slug: 'oyuncu-bilgisayari' },
          { name: 'Tablet',                slug: 'tablet' },
          { name: 'Masaüstü PC',           slug: 'masaustu-pc' }
        ]},
        { name: 'TV & Ses',     slug: 'tv-ses',       children: [
          { name: 'Televizyonlar',         slug: 'televizyonlar' },
          { name: 'Soundbar',              slug: 'soundbar' },
          { name: 'Kulaklıklar',           slug: 'kulakliklar' },
          { name: 'Projeksiyon',           slug: 'projeksiyon' }
        ]},
        { name: 'Ev & Yaşam',   slug: 'ev-yasam',     children: [
          { name: 'Robot Süpürgeler',      slug: 'robot-supurgeler' },
          { name: 'Dikey Süpürgeler',      slug: 'dikey-supurgeler' },
          { name: 'Kahve Makineleri',      slug: 'kahve-makineleri' }
        ]},
        { name: 'Oyun & Konsol', slug: 'oyun-konsol', children: [
          { name: 'PlayStation',           slug: 'playstation' },
          { name: 'VR Başlıklar',          slug: 'vr-basliklar' },
          { name: 'Konsol Aksesuarları',   slug: 'konsol-aksesuarlari' }
        ]}
      ];
      for (let i = 0; i < tree.length; i++) {
        const p = tree[i];
        const r = await pool.query(
          'INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1,$2,NULL,$3) RETURNING id',
          [p.name, p.slug, i]
        );
        const parentId = r.rows[0].id;
        for (let j = 0; j < p.children.length; j++) {
          const c = p.children[j];
          await pool.query(
            'INSERT INTO categories (name, slug, parent_id, sort_order) VALUES ($1,$2,$3,$4)',
            [c.name, c.slug, parentId, j]
          );
        }
      }
      console.log('Hiyerarşik kategoriler seed edildi');
    }

    console.log('PostgreSQL veritabani hazir');
  } catch(e) {
    console.error('DB hatasi:', e.message);
    // process.exit kaldırıldı — server ayakta kalır, loglarda hata görünür
  }
}

initDB();
module.exports = db;
