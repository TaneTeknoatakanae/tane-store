const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'tane-store.db'), (err) => {
  if (err) console.error('❌ Veritabanı hatası:', err.message);
  else console.log('✅ Veritabanına bağlandı');
});

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      image_url TEXT,
      description TEXT,
      category TEXT,
      tane_price REAL NOT NULL,
      tane_url TEXT,
      stock INTEGER DEFAULT 99,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, err => { if (!err) console.log('✅ Products tablosu hazır'); });

  db.run(`
    CREATE TABLE IF NOT EXISTS prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      price REAL,
      url TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `, err => { if (!err) console.log('✅ Prices tablosu hazır'); });

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      customer_address TEXT NOT NULL,
      customer_city TEXT NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'Beklemede',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, err => { if (!err) console.log('✅ Orders tablosu hazır'); });

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `, err => { if (!err) console.log('✅ Order Items tablosu hazır'); });

  db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
    if (!err && row.count === 0) {
      const samples = [
        {
          name: "Sony WH-1000XM5 Kulaklık",
          image_url: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=400",
          description: "Endüstri lideri gürültü engelleme teknolojisi ile 30 saate kadar pil ömrü.",
          category: "Elektronik",
          tane_price: 4299,
          stock: 15
        },
        {
          name: "Nike Air Max 270",
          image_url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400",
          description: "Air Max serisinin en büyük hava yastığı ile maksimum konfor.",
          category: "Giyim",
          tane_price: 2199,
          stock: 28
        },
        {
          name: "Logitech MX Master 3",
          image_url: "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400",
          description: "Profesyonel iş akışı için tasarlanmış gelişmiş kablosuz mouse.",
          category: "Elektronik",
          tane_price: 1899,
          stock: 33
        }
      ];

      const stmt = db.prepare(`
        INSERT INTO products (name, image_url, description, category, tane_price, stock)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      samples.forEach(p => stmt.run(p.name, p.image_url, p.description, p.category, p.tane_price, p.stock));
      stmt.finalize();
      console.log('✅ Örnek ürünler eklendi');
    }
  });

});

module.exports = db;
