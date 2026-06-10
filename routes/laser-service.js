const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const db      = require('../database/db');

// Lazer dosyaları ayrı klasör — Railway Volume altında kalıcı
const laserDir = path.join(__dirname, '..', 'public', 'uploads', 'laser');
if (!fs.existsSync(laserDir)) fs.mkdirSync(laserDir, { recursive: true });

const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.svg', '.dxf'];
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, laserDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'laser-' + Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_EXT.includes(path.extname(file.originalname).toLowerCase()))
});

function getCfg(cb) {
  db.get(`SELECT value FROM app_settings WHERE key = 'laser_pricing'`, [], (err, row) => {
    if (err || !row) return cb(err || new Error('Lazer fiyat ayarı bulunamadı'));
    try { cb(null, JSON.parse(row.value)); } catch (e) { cb(e); }
  });
}

// Sunucu-otoritatif fiyat (istemciden gelen geometriye güven, fiyatı sunucu hesaplar)
function computeQuote(cfg, p) {
  const mat = cfg.materials[p.material];
  if (!mat) throw new Error('Geçersiz materyal');
  const mode = p.mode === 'cut' ? 'cut' : 'engrave';
  const qty  = Math.min(1000, Math.max(1, Math.round(Number(p.quantity) || 1)));
  const r2 = n => Math.round(n * 100) / 100;

  const w = Math.max(0, Number(p.width_mm) || 0);
  const h = Math.max(0, Number(p.height_mm) || 0);
  const area_cm2 = (w * h) / 100;

  let unit = 0, est_minutes = 0, coverage = 0, path_length_m = 0, passes = 0, materialCost = 0, workCost = 0;

  if (mode === 'cut') {
    if (!mat.cuttable) throw new Error(`${mat.label} bu lazerle kesilemez (yalnızca gravür)`);
    path_length_m = Math.max(0, Number(p.path_length_m) || 0);
    if (path_length_m <= 0) throw new Error('Kesim yolu hesaplanamadı (vektör/SVG gerekli)');
    passes = mat.passes || 1;
    workCost = path_length_m * cfg.cut.ratePerMeter * passes;
    materialCost = (mat.costPerCm2 || 0) * area_cm2;
    est_minutes = (path_length_m * passes) / cfg.cut.mPerMin;
    unit = workCost + materialCost;
  } else {
    if (area_cm2 <= 0) throw new Error('Gravür alanı hesaplanamadı (boyut girin)');
    coverage = Math.min(1, Math.max(0.05, Number(p.coverage) || 0.5));
    const covFactor = 0.3 + 0.7 * coverage;
    workCost = area_cm2 * cfg.engrave.ratePerCm2 * covFactor;
    materialCost = (mat.costPerCm2 || 0) * area_cm2;     // "kendi ürünüm" → 0
    est_minutes = (area_cm2 * coverage) / cfg.engrave.cm2PerMin;
    unit = workCost + materialCost;
  }

  let total = cfg.baseFee + unit * qty;
  if (cfg.minPrice && total < cfg.minPrice) total = cfg.minPrice;

  return {
    mode, quantity: qty, area_cm2: r2(area_cm2), path_length_m: r2(path_length_m),
    coverage: r2(coverage), passes, est_minutes: r2(est_minutes),
    baseFee: r2(cfg.baseFee), workCost: r2(workCost), materialCost: r2(materialCost),
    unitPrice: r2(unit), totalPrice: r2(total), materialLabel: mat.label
  };
}

// ── GET /api/laser/config ──
router.get('/config', (req, res) => {
  getCfg((err, cfg) => {
    if (err) return res.status(500).json({ error: 'Lazer ayarı okunamadı' });
    const materials = Object.entries(cfg.materials).map(([key, m]) => ({ key, label: m.label, cuttable: m.cuttable }));
    res.json({ materials, maxFileMB: 60, allowedFormats: ALLOWED_EXT });
  });
});

// ── POST /api/laser/upload ──
router.post('/upload', (req, res) => {
  upload.single('design')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Dosya çok büyük (max 60MB)' });
      return res.status(400).json({ error: 'Yükleme hatası: ' + err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Geçersiz dosya. PNG, JPG, SVG veya DXF yükleyin.' });
    res.json({
      file_path: '/uploads/laser/' + req.file.filename,
      original_name: req.file.originalname,
      file_format: path.extname(req.file.originalname).toLowerCase().replace('.', ''),
      size: req.file.size
    });
  });
});

// ── POST /api/laser/quote ──
router.post('/quote', (req, res) => {
  const b = req.body;
  if (!b.file_path || !b.original_name) return res.status(400).json({ error: 'Önce tasarım yükleyin' });
  if (!b.material) return res.status(400).json({ error: 'Materyal seçin' });

  const safeName = path.basename(String(b.file_path));
  if (!fs.existsSync(path.join(laserDir, safeName))) {
    return res.status(400).json({ error: 'Yüklenen dosya bulunamadı, tekrar yükleyin' });
  }

  getCfg((err, cfg) => {
    if (err) return res.status(500).json({ error: 'Lazer ayarı okunamadı' });
    let q;
    try { q = computeQuote(cfg, b); } catch (e) { return res.status(400).json({ error: e.message }); }

    const userId = req.session?.userId || null;
    db.run(
      `INSERT INTO laser_jobs
         (user_id, mode, original_name, file_path, file_format, material, width_mm, height_mm,
          area_cm2, path_length_m, coverage, passes, est_minutes, quantity, unit_price, total_price, note, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'quoted')`,
      [userId, q.mode, String(b.original_name).substring(0, 200), '/uploads/laser/' + safeName,
       (b.file_format || '').substring(0, 10), b.material, Number(b.width_mm) || 0, Number(b.height_mm) || 0,
       q.area_cm2, q.path_length_m, q.coverage, q.passes, q.est_minutes, q.quantity, q.unitPrice, q.totalPrice,
       (b.note || '').substring(0, 1000)],
      function (e2) {
        if (e2) return res.status(500).json({ error: 'Teklif kaydedilemedi: ' + e2.message });
        res.json({ laser_job_id: this.lastID, ...q });
      }
    );
  });
});

module.exports = router;
