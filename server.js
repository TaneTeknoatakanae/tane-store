const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const db = require('./database/db');

const app = express();
const PORT = 3000;

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

app.use(cors());
app.use(express.json());
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
app.use('/api/products', productRoutes);
app.use('/api/prices', priceRoutes);
app.use('/api/orders', orderRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Tane Store çalışıyor → http://localhost:${PORT}`);
});