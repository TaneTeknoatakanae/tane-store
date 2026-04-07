require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const db = require('./database/db');
const crypto = require('crypto');
const adminAuth = require('./middleware/adminAuth');

const app = express();
const PORT = process.env.PORT || 3000; 

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Tane Store çalışıyor → Port: ${PORT}`);
});

// ── Akakçe otomatik sync — her gün saat 03:00'da ──────────
cron.schedule('0 3 * * *', () => {
  console.log('[cron] Akakçe sync tetiklendi');
  require('./akakce-sync').run().catch(e =>
    console.error('[cron] Akakçe sync hata:', e.message)
  );
}, { timezone: 'Europe/Istanbul' });

// Uploads klasörünü oluştur
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer ayarları — fotoğrafları public/uploads klasörüne kaydet
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'product-' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp|gif/;
    cb(null, allowed.test(file.mimetype));
  }
});

app.set('trust proxy', 1); // Railway reverse proxy
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'tane-store-secret-2026',
  resave: false,
  saveUninitialized: false,
  name: 'ts_sid', // don't reveal default connect.sid
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
}));

// ── Rate limiters ──────────────────────────────────────────────────────────
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 5,                     // 5 attempts per window
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.' }
});

const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'İstek limiti aşıldı.' }
});
// ── Admin routes (before static) ──────────────────────────────────────────
const adminAuthRoutes = require('./routes/admin-auth');
app.use('/api/admin', adminApiLimiter);
app.post('/api/admin/login', adminLoginLimiter, (req, res, next) => next()); // extra rate limit on login
app.use('/api/admin', adminAuthRoutes);

// Protect /admin.html — redirect unauthenticated requests server-side
app.get('/admin.html', (req, res, next) => {
  if (!req.session || !req.session.isAdmin) {
    return res.redirect('/admin-login.html');
  }
  const ADMIN_TIMEOUT = 4 * 60 * 60 * 1000;
  if (Date.now() - (req.session.adminLoginTime || 0) > ADMIN_TIMEOUT) {
    req.session.destroy(() => {});
    return res.redirect('/admin-login.html');
  }
  next(); // serve the file
});

// SEO: Serve product.html with injected meta tags for crawlers
app.get('/product.html', (req, res, next) => {
  const { id } = req.query;
  if (!id) return next();
  db.get('SELECT * FROM products WHERE id = ?', [id], (err, p) => {
    if (err || !p) return next();
    const fs = require('fs');
    let html = fs.readFileSync(path.join(__dirname, 'public', 'product.html'), 'utf8');
    const title = `${p.name} — Tane Store`;
    const desc = (p.description || `${p.name} - Tane Store'da satın al`).substring(0, 160).replace(/"/g, '&quot;');
    const img = p.image_url ? `https://tanetekno.com${p.image_url}` : 'https://tanetekno.com/AmblemTane.png';
    const meta = `<meta name="description" content="${desc}">
    <meta property="og:title" content="${title.replace(/"/g,'&quot;')}">
    <meta property="og:description" content="${desc}">
    <meta property="og:image" content="${img}">
    <meta property="og:url" content="https://tanetekno.com/product.html?id=${id}">
    <meta property="og:type" content="product">
    <meta name="twitter:card" content="summary_large_image">`;
    html = html.replace('<!-- OG_META -->', meta);
    html = html.replace('<title>Tane Store — Ürün</title>', `<title>${title}</title>`);
    res.send(html);
  });
});

// Pageview tracking middleware
const TRACKED_PAGES = ['/', '/landing', '/product.html', '/track', '/login', '/register', '/hesabim', '/hakkimizda', '/iletisim'];
app.use((req, res, next) => {
  if (req.method === 'GET' && TRACKED_PAGES.includes(req.path)) {
    const ua = req.headers['user-agent'] || '';
    const device = /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop';
    const referrer = (req.headers['referer'] || '').substring(0, 200);
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const ip_hash = crypto.createHash('md5').update(ip).digest('hex');
    const product_id = (req.path === '/product.html' && req.query.id) ? (parseInt(req.query.id) || null) : null;
    db.run('INSERT INTO pageviews (page, referrer, device, ip_hash, product_id) VALUES (?, ?, ?, ?, ?)',
      [req.path, referrer, device, ip_hash, product_id]);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Fotoğraf yükleme endpoint'i — admin only
app.post('/api/upload', upload.single('image'), adminAuth, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi' });
  const imageUrl = '/uploads/' + req.file.filename;
  res.json({ url: imageUrl, message: '✅ Fotoğraf yüklendi' });
});

const productRoutes = require('./routes/products');
const priceRoutes = require('./routes/prices');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const analyticsRoutes = require('./routes/analytics');
const scrapeUrlRoutes = require('./routes/scrape-url');
app.use('/api/products', productRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/scrape-url', scrapeUrlRoutes);
app.use('/api/price-compare', require('./routes/price-compare'));
app.use('/api/paytr', require('./routes/paytr'));
app.use('/api/categories', require('./routes/categories'));

// SEO-friendly category URL: /kategori/bilgisayar/laptop → landing.html (server tarafı slug → query)
app.get('/kategori/:parent/:child?', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/hesabim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hesabim.html')));
app.get('/hakkimizda', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hakkimizda.html')));
app.get('/teslimat-iade', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teslimat-iade.html')));
app.get('/gizlilik', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gizlilik.html')));
app.get('/mesafeli-satis', (req, res) => res.sendFile(path.join(__dirname, 'public', 'mesafeli-satis.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.get('/iletisim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'iletisim.html')));
app.get('/kvkk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kvkk.html')));
app.get('/cerez-politikasi', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cerez-politikasi.html')));
app.get('/on-bilgilendirme', (req, res) => res.sendFile(path.join(__dirname, 'public', 'on-bilgilendirme.html')));
app.get('/odeme', (req, res) => res.sendFile(path.join(__dirname, 'public', 'odeme.html')));

// ─── Dinamik sitemap.xml ───
app.get('/sitemap.xml', (req, res) => {
  const SITE = 'https://www.tanetekno.com';
  const today = new Date().toISOString().split('T')[0];
  const staticPages = [
    { url: '/',                  pri: '1.0', freq: 'daily'   },
    { url: '/landing',           pri: '0.9', freq: 'daily'   },
    { url: '/hakkimizda',        pri: '0.5', freq: 'monthly' },
    { url: '/iletisim',          pri: '0.5', freq: 'monthly' },
    { url: '/teslimat-iade',     pri: '0.4', freq: 'monthly' },
    { url: '/gizlilik',          pri: '0.3', freq: 'yearly'  },
    { url: '/kvkk',              pri: '0.3', freq: 'yearly'  },
    { url: '/cerez-politikasi',  pri: '0.3', freq: 'yearly'  },
    { url: '/mesafeli-satis',    pri: '0.3', freq: 'yearly'  },
    { url: '/on-bilgilendirme',  pri: '0.3', freq: 'yearly'  }
  ];
  db.all('SELECT id, name, COALESCE(category, \'\') AS category, created_at FROM products', [], (err, rows) => {
    const escape = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const items = [];
    staticPages.forEach(p => items.push(
      `<url><loc>${SITE}${p.url}</loc><lastmod>${today}</lastmod><changefreq>${p.freq}</changefreq><priority>${p.pri}</priority></url>`
    ));
    // Hiyerarşik kategoriler — DB'den çekilen ağaç
    db.all('SELECT id, slug, parent_id FROM categories', [], (errC, cats) => {
      const catRows = cats || [];
      const parents = catRows.filter(c => !c.parent_id);
      parents.forEach(p => {
        items.push(`<url><loc>${SITE}/kategori/${p.slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
        catRows.filter(c => c.parent_id === p.id).forEach(c => {
          items.push(`<url><loc>${SITE}/kategori/${p.slug}/${c.slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`);
        });
      });
      sendXml();
    });
    function sendXml() {
    // Products
    (rows || []).forEach(r => {
      const lastmod = r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : today;
      items.push(`<url><loc>${SITE}/product.html?id=${r.id}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`);
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join('\n')}\n</urlset>`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
    } // end sendXml
  });
});
app.get('/siparis-alindi', (req, res) => res.sendFile(path.join(__dirname, 'public', 'siparis-alindi.html')));


