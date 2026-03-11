require('dotenv').config();
const xlsx = require('xlsx');
const { Pool } = require('pg');

// Railway PostgreSQL bağlantısı
const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres:GqkoaepmlWoBkUHWFilygxysXSnVweLJ@turntable.proxy.rlwy.net:34731/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Hepsiburada görsel URL'sini düzelt
function fixImageUrl(url) {
  if (!url || !url.trim()) return null;
  return url.trim().replace('{size}', '800');
}

// HTML açıklamayı temizle (düz metin)
function cleanDesc(html) {
  if (!html) return null;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

async function run() {
  const wb = xlsx.readFile('C:/Users/aekic/Downloads/UrunBilgisi-10-03-2026-15_34.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { header: 1 });

  const headers = rows[0];
  const dataRows = rows.slice(1).filter(r => r[1]); // Ürün Adı boş olmayanlar

  console.log(`Toplam ${dataRows.length} ürün yüklenecek...`);

  // Eksik sütunları ekle
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_price REAL`);
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS images TEXT`);

  let success = 0;
  let skip = 0;

  for (const row of dataRows) {
    const sku       = (row[0] || '').toString().trim();
    const name      = (row[1] || '').toString().trim();
    const desc      = cleanDesc(row[2]);
    // Görsel 1-10 (indeks 3-12)
    const allImages = [row[3],row[4],row[5],row[6],row[7],row[8],row[9],row[10],row[11],row[12]]
      .map(fixImageUrl).filter(Boolean);
    const image_url = allImages[0] || null;
    const images    = JSON.stringify(allImages);

    if (!name) { skip++; continue; }

    // Aynı SKU varsa güncelle (görselleri ekle)
    if (sku) {
      const existing = await pool.query('SELECT id FROM products WHERE sku = $1', [sku]);
      if (existing.rows.length > 0) {
        await pool.query(
          'UPDATE products SET image_url=$1, images=$2 WHERE sku=$3',
          [image_url, images, sku]
        );
        console.log(`  Güncellendi (görseller): ${name}`);
        success++;
        continue;
      }
    }

    await pool.query(
      `INSERT INTO products (name, image_url, images, description, category, sku, tane_price, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [name, image_url, images, desc, 'Genel', sku || null, 0, 99]
    );

    console.log(`  ✓ ${name}`);
    success++;
  }

  console.log(`\nTamamlandi: ${success} eklendi, ${skip} atlandı`);
  await pool.end();
}

run().catch(e => {
  console.error('Hata:', e.message);
  process.exit(1);
});
