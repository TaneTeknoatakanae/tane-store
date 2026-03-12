require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
const cron = require('node-cron');
const db = require('./database/db');

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

// ── Arbitraj tarama — her gün saat 04:00'da ────────────────
cron.schedule('0 4 * * *', () => {
  console.log('[cron] Arbitraj taraması tetiklendi');
  require('./akakce-arbitrage').run().catch(e =>
    console.error('[cron] Arbitraj hata:', e.message)
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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'tane-store-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 gün
}));
app.use(express.static(path.join(__dirname, 'public')));

// Fotoğraf yükleme endpoint'i
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Dosya yüklenemedi' });
  const imageUrl = '/uploads/' + req.file.filename;
  res.json({ url: imageUrl, message: '✅ Fotoğraf yüklendi' });
});

const productRoutes = require('./routes/products');
const priceRoutes = require('./routes/prices');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const couponRoutes = require('./routes/coupons');
const authRoutes = require('./routes/auth');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
app.use('/api/products', productRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/wishlist', wishlistRoutes);

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

// ── Arbitraj API ─────────────────────────────────────────────────────────────
// Son tarama sonuçları: GET /api/arbitrage/latest?limit=50
app.get('/api/arbitrage/latest', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  db.all(
    `SELECT i.*, r.run_timestamp, r.total_scanned
       FROM arbitrage_items i
       JOIN arbitrage_runs r ON r.id = i.run_id
      WHERE r.id = (SELECT id FROM arbitrage_runs ORDER BY created_at DESC LIMIT 1)
      ORDER BY i.gap_pct DESC
      LIMIT $1`,
    [limit],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Tarama geçmişi: GET /api/arbitrage/runs
app.get('/api/arbitrage/runs', (_req, res) => {
  db.all(
    `SELECT * FROM arbitrage_runs ORDER BY created_at DESC LIMIT 30`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Manuel tetikleme + durum takibi
let arbRunning = false;
let arbStatus  = { running: false, startedAt: null, log: [] };

function arbLog(msg) {
  const line = `[${new Date().toLocaleTimeString('tr-TR')}] ${msg}`;
  arbStatus.log.push(line);
  if (arbStatus.log.length > 200) arbStatus.log.shift();
  console.log('[arb]', msg);
}

app.post('/api/admin/run-arbitrage', (_req, res) => {
  if (arbRunning) return res.json({ running: true, message: 'Zaten çalışıyor.' });
  res.json({ running: false, message: 'Arbitraj taraması başlatıldı.' });
  arbRunning        = true;
  arbStatus.running = true;
  arbStatus.startedAt = new Date().toISOString();
  arbStatus.log     = ['Tarama başladı…'];

  // Patch console.log for this run to capture output
  const origLog = console.log;
  console.log = (...args) => { origLog(...args); arbLog(args.join(' ')); };

  require('./akakce-arbitrage').run()
    .catch(e => arbLog('HATA: ' + e.message))
    .finally(() => {
      console.log = origLog;
      arbRunning        = false;
      arbStatus.running = false;
      arbLog('Tarama tamamlandı.');
    });
});

// Durum sorgulama: GET /api/admin/arbitrage-status
app.get('/api/admin/arbitrage-status', (_req, res) => {
  res.json(arbStatus);
});

// Admin sayfası
app.get('/admin/arbitrage', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin-arbitrage.html'))
);

