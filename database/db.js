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
    await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`CREATE INDEX IF NOT EXISTS products_active_idx ON products(is_active)`);

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
        { name: 'Hobi & Mühendislik', slug: 'hobi-muhendislik', children: [
          { name: '3D Printer',            slug: '3d-printer' },
          { name: '3D Tarayıcı',           slug: '3d-tarayici' }
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

    // ── Sonradan eklenen alt kategoriler (idempotent) ──────
    const extraSubcats = [
      { parent: 'bilgisayar',  name: 'Monitör',                 slug: 'monitor' },
      { parent: 'bilgisayar',  name: 'Bilgisayar Bileşenleri',  slug: 'bilgisayar-bilesenleri' },
      { parent: 'bilgisayar',  name: 'RAM',                     slug: 'ram' },
      { parent: 'bilgisayar',  name: 'SSD',                     slug: 'ssd' },
      { parent: 'bilgisayar',  name: 'GPU',                     slug: 'gpu' },
      { parent: 'oyun-konsol', name: 'Oyuncu Klavyesi',         slug: 'oyuncu-klavyesi' },
      { parent: 'oyun-konsol', name: 'Oyuncu Mouse',            slug: 'oyuncu-mouse' },
      { parent: 'oyun-konsol', name: 'Oyuncu Kulaklığı',        slug: 'oyuncu-kulakligi' },
      { parent: 'hobi-muhendislik', name: '3D Printer',         slug: '3d-printer' },
      { parent: 'hobi-muhendislik', name: '3D Tarayıcı',        slug: '3d-tarayici' }
    ];
    // Hobi & Mühendislik üst kategoriyi oluştur (idempotent)
    await pool.query(
      `INSERT INTO categories (name, slug, parent_id, sort_order)
       VALUES ('Hobi & Mühendislik', 'hobi-muhendislik', NULL, 10)
       ON CONFLICT (slug) DO NOTHING`
    );
    // TV & Ses kategorisini sil (alt kategorileri ON DELETE CASCADE ile gider)
    await pool.query(`DELETE FROM categories WHERE slug = 'tv-ses' AND parent_id IS NULL`);
    await pool.query(`DELETE FROM categories WHERE slug IN ('televizyonlar','soundbar','kulakliklar','projeksiyon') AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = 'tv-ses')`);
    for (const sc of extraSubcats) {
      const parentRes = await pool.query('SELECT id FROM categories WHERE slug = $1 AND parent_id IS NULL', [sc.parent]);
      if (!parentRes.rows.length) continue;
      await pool.query(
        `INSERT INTO categories (name, slug, parent_id, sort_order)
         VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE parent_id = $3))
         ON CONFLICT (slug) DO NOTHING`,
        [sc.name, sc.slug, parentRes.rows[0].id]
      );
    }

    // ── 3D Baskı Hizmeti & B2B modülleri ───────────────────
    // Genel ayar tablosu (admin'den düzenlenebilir fiyat config'i burada JSON olarak tutulur)
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    // Kullanıcı hesap tipi (bireysel / kurumsal) — B2B için
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'individual'`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tax_no TEXT`);

    // 3D baskı işleri — yüklenen model + hesaplanan teklif
    await pool.query(`CREATE TABLE IF NOT EXISTS print_jobs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_format TEXT,
      material TEXT NOT NULL,
      infill INTEGER NOT NULL DEFAULT 20,
      quality TEXT DEFAULT 'standart',
      volume_cm3 REAL,
      est_grams REAL,
      est_hours REAL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'quoted',
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS print_jobs_order_idx ON print_jobs(order_id)`);

    // B2B kurumsal talepler (toplu sipariş / özel teklif)
    await pool.query(`CREATE TABLE IF NOT EXISTS b2b_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      company_name TEXT NOT NULL,
      tax_office TEXT,
      tax_no TEXT,
      contact_name TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT,
      request_type TEXT NOT NULL DEFAULT 'toplu-siparis',
      details TEXT NOT NULL,
      budget REAL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW()
    )`);

    // 3D baskı fiyat config'i — yoksa varsayılanlarla seed et (admin sonradan düzenler)
    const cfgCheck = await pool.query(`SELECT 1 FROM app_settings WHERE key = 'print_pricing'`);
    if (cfgCheck.rows.length === 0) {
      const defaultPricing = {
        baseFee: 50,                  // sipariş başına taban ücret (₺)
        machineRatePerHour: 15,       // makine/işçilik (₺/saat)
        throughputGramsPerHour: 12,   // ortalama baskı hızı (g/saat) — süre tahmini için
        infillBase: 0.30,             // gram çarpanı = infillBase + infillRange × (infill/100)
        infillRange: 0.70,
        minPrice: 75,                 // minimum sipariş tutarı (₺)
        qualityFactors: {             // baskı kalitesi → süre (makine maliyeti) çarpanı
          taslak: 0.8,                // hızlı/kaba (0.3mm)
          standart: 1.0,              // standart (0.2mm)
          yuksek: 1.5                 // yüksek detay (0.1mm)
        },
        materials: {
          PLA:   { label: 'PLA',              density: 1.24, ratePerGram: 4.0 },
          PETG:  { label: 'PETG',             density: 1.27, ratePerGram: 5.0 },
          ABS:   { label: 'ABS',              density: 1.04, ratePerGram: 5.5 },
          RESIN: { label: 'Reçine (Resin)',   density: 1.10, ratePerGram: 8.0 },
          TPU:   { label: 'TPU (Esnek)',      density: 1.21, ratePerGram: 6.5 },
          ASA:   { label: 'ASA',              density: 1.07, ratePerGram: 6.0 },
          PC:    { label: 'PC (Polikarbonat)',density: 1.20, ratePerGram: 9.0 },
          PA:    { label: 'PA (Naylon)',      density: 1.01, ratePerGram: 9.0 },
          PET:   { label: 'PET',              density: 1.38, ratePerGram: 5.5 },
          PPS:   { label: 'PPS',              density: 1.35, ratePerGram: 14.0 }
        }
      };
      await pool.query(`INSERT INTO app_settings (key, value) VALUES ('print_pricing', $1)`, [JSON.stringify(defaultPricing)]);
      console.log('3D baskı fiyat config seed edildi');
    }

    // ── Lazer Kesim & Gravür Hizmeti ───────────────────────
    await pool.query(`CREATE TABLE IF NOT EXISTS laser_jobs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      mode TEXT NOT NULL DEFAULT 'engrave',
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_format TEXT,
      material TEXT NOT NULL,
      width_mm REAL,
      height_mm REAL,
      area_cm2 REAL,
      path_length_m REAL,
      coverage REAL,
      passes INTEGER DEFAULT 1,
      est_minutes REAL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL DEFAULT 0,
      total_price REAL NOT NULL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'quoted',
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS laser_jobs_order_idx ON laser_jobs(order_id)`);

    const laserCfg = await pool.query(`SELECT 1 FROM app_settings WHERE key = 'laser_pricing'`);
    if (laserCfg.rows.length === 0) {
      const defaultLaser = {
        baseFee: 40,                 // sipariş başına taban ücret (₺)
        minPrice: 60,                // minimum sipariş (₺)
        engrave: { ratePerCm2: 1.2, cm2PerMin: 4 },   // gravür: ₺/cm² (tam kapanım) + hız (cm²/dk)
        cut:     { ratePerMeter: 25, mPerMin: 0.6 },  // kesim: ₺/metre (tek geçiş) + hız (m/dk)
        materials: {
          AHSAP3:   { label: 'Ahşap / Kontrplak 3mm', cuttable: true,  passes: 1, costPerCm2: 0.15 },
          AHSAP5:   { label: 'Ahşap / Kontrplak 5mm', cuttable: true,  passes: 2, costPerCm2: 0.22 },
          MDF3:     { label: 'MDF 3mm',               cuttable: true,  passes: 1, costPerCm2: 0.12 },
          AKRILIK3: { label: 'Koyu Akrilik 3mm',      cuttable: true,  passes: 2, costPerCm2: 0.40 },
          DERI:     { label: 'Deri',                  cuttable: true,  passes: 1, costPerCm2: 0.30 },
          KECE:     { label: 'Keçe',                  cuttable: true,  passes: 1, costPerCm2: 0.10 },
          KARTON:   { label: 'Karton / Mukavva',      cuttable: true,  passes: 1, costPerCm2: 0.05 },
          KAYRAK:   { label: 'Kayrak Taşı (gravür)',  cuttable: false, passes: 0, costPerCm2: 0.35 },
          METAL_AN: { label: 'Anodize / Boyalı Metal (gravür)', cuttable: false, passes: 0, costPerCm2: 0 },
          CAM:      { label: 'Cam / Ayna (gravür)',   cuttable: false, passes: 0, costPerCm2: 0 },
          MUSTERI:  { label: 'Kendi ürünüm (gravür)', cuttable: false, passes: 0, costPerCm2: 0 }
        }
      };
      await pool.query(`INSERT INTO app_settings (key, value) VALUES ('laser_pricing', $1)`, [JSON.stringify(defaultLaser)]);
      console.log('Lazer fiyat config seed edildi');
    }

    console.log('PostgreSQL veritabani hazir');
  } catch(e) {
    console.error('DB hatasi:', e.message);
    // process.exit kaldırıldı — server ayakta kalır, loglarda hata görünür
  }
}

initDB();
module.exports = db;
