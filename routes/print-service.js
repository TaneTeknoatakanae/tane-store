const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../database/db');

// 3D model dosyaları ayrı klasöre — Railway Volume (/app/public/uploads) altında kalıcı
const modelsDir = path.join(__dirname, '..', 'public', 'uploads', 'models');
if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

const ALLOWED_EXT = ['.stl', '.obj', '.3mf'];
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, modelsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'model-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60MB — 3D modeller büyük olabilir
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ALLOWED_EXT.includes(ext));
  }
});

// Fiyat config'ini DB'den oku (admin düzenleyebilir)
function getPricingConfig(cb) {
  db.get(`SELECT value FROM app_settings WHERE key = 'print_pricing'`, [], (err, row) => {
    if (err || !row) return cb(err || new Error('Fiyat ayarı bulunamadı'));
    try { cb(null, JSON.parse(row.value)); }
    catch (e) { cb(e); }
  });
}

// Sunucu-otoritatif fiyat hesabı (istemciden gelen fiyata GÜVENME — sadece geometrik hacme güven)
function computeQuote(cfg, { volume_cm3, material, infill, quality, quantity }) {
  const mat = cfg.materials[material];
  if (!mat) throw new Error('Geçersiz materyal');

  const vol  = Math.max(0, Number(volume_cm3) || 0);            // cm³
  const inf  = Math.min(100, Math.max(0, Number(infill) || 20)); // %
  const qty  = Math.min(1000, Math.max(1, Math.round(Number(quantity) || 1)));
  const qFac = (cfg.qualityFactors && cfg.qualityFactors[quality]) || 1.0;

  const infillFactor = cfg.infillBase + cfg.infillRange * (inf / 100);
  const grams = vol * mat.density * infillFactor;
  const hours = (grams / cfg.throughputGramsPerHour) * qFac;

  const materialCost = grams * mat.ratePerGram;
  const machineCost  = hours * cfg.machineRatePerHour;
  let   unitPrice    = materialCost + machineCost;

  let total = cfg.baseFee + unitPrice * qty;
  if (cfg.minPrice && total < cfg.minPrice) total = cfg.minPrice;

  const r2 = n => Math.round(n * 100) / 100;
  return {
    grams: r2(grams), hours: r2(hours), quantity: qty,
    baseFee: r2(cfg.baseFee),
    materialCost: r2(materialCost), machineCost: r2(machineCost),
    unitPrice: r2(unitPrice), totalPrice: r2(total),
    materialLabel: mat.label
  };
}

// ── GET /api/print/config — materyaller + parametreler (UI için, public) ──
router.get('/config', (req, res) => {
  getPricingConfig((err, cfg) => {
    if (err) return res.status(500).json({ error: 'Fiyat ayarı okunamadı' });
    // İstemciye oran/yoğunluk detayını sızdırmadan sadece görünür alanları ver
    const materials = Object.entries(cfg.materials).map(([key, m]) => ({ key, label: m.label }));
    res.json({
      materials,
      qualities: [
        { key: 'taslak',   label: 'Taslak (0.3mm, hızlı)' },
        { key: 'standart', label: 'Standart (0.2mm)' },
        { key: 'yuksek',   label: 'Yüksek Detay (0.1mm)' }
      ],
      infillDefault: 20,
      maxFileMB: 60,
      allowedFormats: ALLOWED_EXT
    });
  });
});

// ── POST /api/print/upload — model dosyası yükle ──
router.post('/upload', (req, res) => {
  upload.single('model')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Dosya çok büyük (max 60MB)' });
      return res.status(400).json({ error: 'Yükleme hatası: ' + err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Geçersiz dosya. Sadece STL, OBJ, 3MF kabul edilir.' });
    res.json({
      file_path: '/uploads/models/' + req.file.filename,
      original_name: req.file.originalname,
      file_format: path.extname(req.file.originalname).toLowerCase().replace('.', ''),
      size: req.file.size
    });
  });
});

// ── POST /api/print/quote — fiyat hesapla + print_job kaydet ──
router.post('/quote', (req, res) => {
  const { file_path, original_name, file_format, volume_cm3, material, infill, quality, quantity, note } = req.body;

  if (!file_path || !original_name) return res.status(400).json({ error: 'Önce model yükleyin' });
  if (!volume_cm3 || Number(volume_cm3) <= 0) return res.status(400).json({ error: 'Model hacmi hesaplanamadı' });
  if (!material) return res.status(400).json({ error: 'Materyal seçin' });

  // Yüklenen dosyanın gerçekten var olduğunu doğrula (path injection / sahte path koruması)
  const safeName = path.basename(String(file_path));
  if (!fs.existsSync(path.join(modelsDir, safeName))) {
    return res.status(400).json({ error: 'Yüklenen dosya bulunamadı, tekrar yükleyin' });
  }

  getPricingConfig((err, cfg) => {
    if (err) return res.status(500).json({ error: 'Fiyat ayarı okunamadı' });
    let q;
    try { q = computeQuote(cfg, { volume_cm3, material, infill, quality, quantity }); }
    catch (e) { return res.status(400).json({ error: e.message }); }

    const userId = req.session?.userId || null;
    db.run(
      `INSERT INTO print_jobs
         (user_id, original_name, file_path, file_format, material, infill, quality,
          volume_cm3, est_grams, est_hours, quantity, unit_price, total_price, note, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'quoted')`,
      [userId, String(original_name).substring(0, 200), '/uploads/models/' + safeName,
       (file_format || '').substring(0, 10), material, Number(infill) || 20, quality || 'standart',
       Number(volume_cm3), q.grams, q.hours, q.quantity, q.unitPrice, q.totalPrice,
       (note || '').substring(0, 1000)],
      function (e2) {
        if (e2) return res.status(500).json({ error: 'Teklif kaydedilemedi: ' + e2.message });
        res.json({ print_job_id: this.lastID, ...q });
      }
    );
  });
});

module.exports = router;
