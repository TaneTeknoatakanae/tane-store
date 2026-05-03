/**
 * scripts/migrate-images.js
 *
 * DB'deki tüm ürünlerin external image URL'lerini (Amazon, MediaMarkt vb.)
 * kendi sunucumuza indirir, public/uploads/migrated/ klasörüne kaydeder ve
 * DB'deki image_url + images alanlarını local URL'lerle günceller.
 *
 * Kullanım:
 *   - Lokal: node scripts/migrate-images.js
 *   - Railway: admin panelinden tetiklenebilir (POST /api/admin/migrate-images)
 *
 * Idempotent: zaten /uploads/ ile başlayan URL'leri atlar.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../database/db');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'migrated');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function isExternal(url) {
  if (!url) return false;
  // Local URL ise atla
  if (url.startsWith('/uploads/') || url.startsWith('/')) return false;
  // tanetekno.com kendi domain'i ise atla
  if (url.includes('tanetekno.com')) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

function getExt(url, contentType) {
  // URL'den uzantı çek
  const m = url.split('?')[0].match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  // Content-Type fallback
  if (contentType) {
    if (contentType.includes('jpeg')) return 'jpg';
    if (contentType.includes('png'))  return 'png';
    if (contentType.includes('webp')) return 'webp';
    if (contentType.includes('gif'))  return 'gif';
  }
  return 'jpg';
}

async function downloadImage(url, productId, idx) {
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxContentLength: 10 * 1024 * 1024, // 10MB max
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Referer': new URL(url).origin
      }
    });
    const ext = getExt(url, resp.headers['content-type']);
    const filename = `prod-${productId}-${idx}-${Date.now()}.${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, resp.data);
    return `/uploads/migrated/${filename}`;
  } catch (e) {
    return null;
  }
}

function getAllProducts() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, name, image_url, images FROM products ORDER BY id', [], (err, rows) => {
      if (err) reject(err); else resolve(rows || []);
    });
  });
}

function updateProduct(id, image_url, images) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE products SET image_url = ?, images = ? WHERE id = ?',
      [image_url, images, id],
      (err) => err ? reject(err) : resolve());
  });
}

async function migrate(onProgress) {
  const products = await getAllProducts();
  const stats = { total: products.length, processed: 0, downloaded: 0, skipped: 0, failed: 0 };

  for (const p of products) {
    stats.processed++;
    let newImageUrl = p.image_url;
    let newImagesArr = [];
    let didChange = false;

    // Mevcut images JSON
    let existingImgs = [];
    try { existingImgs = p.images ? JSON.parse(p.images) : []; } catch(_) {}

    // Birleştir: ana görsel + ek görseller (tekrarsız)
    const allImgs = [];
    if (p.image_url) allImgs.push(p.image_url);
    existingImgs.forEach(img => { if (img && !allImgs.includes(img)) allImgs.push(img); });

    // Her görseli işle
    for (let i = 0; i < allImgs.length; i++) {
      const url = allImgs[i];
      if (!isExternal(url)) {
        newImagesArr.push(url);
        continue;
      }
      const localUrl = await downloadImage(url, p.id, i);
      if (localUrl) {
        newImagesArr.push(localUrl);
        if (i === 0) newImageUrl = localUrl;
        stats.downloaded++;
        didChange = true;
      } else {
        // Download fail — orijinali tut
        newImagesArr.push(url);
        stats.failed++;
      }
    }

    if (didChange) {
      await updateProduct(p.id, newImageUrl, JSON.stringify(newImagesArr));
    } else {
      stats.skipped++;
    }

    if (onProgress) onProgress({ ...stats, current: p.name });

    // Rate limit — yumuşak (CloudFlare/CDN tetiklememek için)
    await new Promise(r => setTimeout(r, 250));
  }

  return stats;
}

// CLI'dan çalıştırma
if (require.main === module) {
  console.log('▶ Görsel migration başlıyor…');
  const startedAt = Date.now();
  migrate((p) => {
    process.stdout.write(`\r[${p.processed}/${p.total}] indirilen:${p.downloaded} atlanan:${p.skipped} hata:${p.failed} — ${p.current.substring(0,40)}            `);
  }).then(stats => {
    const sec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`\n\n✅ Tamamlandı (${sec}sn)`);
    console.log(`   Toplam ürün: ${stats.total}`);
    console.log(`   İndirilen görsel: ${stats.downloaded}`);
    console.log(`   Atlanan (zaten local): ${stats.skipped}`);
    console.log(`   İndirilemeyen: ${stats.failed}`);
    process.exit(0);
  }).catch(e => {
    console.error('\n❌ HATA:', e.message);
    process.exit(1);
  });
}

module.exports = { migrate };
