const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'tane-store.db'), (err) => {
  if (err) console.error('❌ Veritabanı hatası:', err.message);
  else console.log('✅ Veritabanına bağlandı');
});

db.serialize(() => {

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    rating REAL DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    price REAL,
    url TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_email TEXT,
    customer_address TEXT NOT NULL,
    customer_city TEXT NOT NULL,
    total_price REAL NOT NULL,
    coupon_code TEXT,
    discount_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'Beklemede',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    value REAL NOT NULL,
    min_order REAL DEFAULT 0,
    usage_limit INTEGER,
    used_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    city TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wishlist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    UNIQUE(user_id, product_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  // Mevcut veritabanı için güvenli migrasyon
  const migrations = [
    "ALTER TABLE products ADD COLUMN brand TEXT",
    "ALTER TABLE products ADD COLUMN sku TEXT",
    "ALTER TABLE products ADD COLUMN discount_price REAL",
    "ALTER TABLE products ADD COLUMN rating REAL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN review_count INTEGER DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN coupon_code TEXT",
    "ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0",
    "ALTER TABLE orders ADD COLUMN user_id INTEGER",
    "ALTER TABLE orders ADD COLUMN shipping_carrier TEXT",
    "ALTER TABLE orders ADD COLUMN shipping_code TEXT"
  ];
  migrations.forEach(sql => db.run(sql, () => {}));

});

module.exports = db;
