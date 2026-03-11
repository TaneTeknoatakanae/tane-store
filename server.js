require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
const db = require('./database/db');

const app = express();
const PORT = process.env.PORT || 3000; 

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Tane Store çalışıyor → Port: ${PORT}`);
});

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

