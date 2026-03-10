// Tane Store — Hepsiburada Excel Import
// Kullanım: node excel-yukle.js
// UrunBilgisi Excel dosyasındaki ürünleri veritabanına ekler

const xlsx = require('xlsx');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const EXCEL_PATH = path.join(process.env.USERPROFILE, 'Downloads', 'UrunBilgisi-10-03-2026-15_34.xlsx');
const DB_PATH = path.join(__dirname, 'database', 'tane-store.db');

// HTML etiketlerini temizle
function stripHtml(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#[0-9]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 1000);
}

// Ürün adına göre kategori belirle
function getCategory(name) {
  const n = name.toLowerCase();
  if (n.includes('kitap') || n.includes('yayın') || n.includes('zamanı') || n.includes('arkadaşları') ||
      n.includes('ağacının') || n.includes('porsuk') || n.includes('kültür') || n.includes('dahiler') ||
      n.includes('kuşlar') || n.includes('aritmetik') || n.includes('bilgi kartı') || n.includes('inatçı'))
    return 'Kitap';
  if (n.includes('mouse') || n.includes('klavye') || n.includes('keyboard') || n.includes('monitor') ||
      n.includes('ekran') || n.includes('ssd') || n.includes('harddisk') || n.includes('ram') ||
      n.includes('anakart') || n.includes('kamera') || n.includes('mikrofon') || n.includes('kulaklık') ||
      n.includes('playstation') || n.includes('gaming') || n.includes('yazıcı') || n.includes('laptop') ||
      n.includes('notebook') || n.includes('usb') || n.includes('wi-fi') || n.includes('tarayıcı') ||
      n.includes('espresso') || n.includes('epson') || n.includes('asus') || n.includes('samsung') ||
      n.includes('sony') || n.includes('philips') || n.includes('wd ') || n.includes('sandisk') ||
      n.includes('kingston') || n.includes('hp ') || n.includes('razer') || n.includes('steelseries') ||
      n.includes('xiaomi') || n.includes('tp-link') || n.includes('audio') || n.includes('viewsonic') ||
      n.includes('thrustmaster') || n.includes('portal') || n.includes('akg') || n.includes('creality'))
    return 'Elektronik';
  if (n.includes('testere') || n.includes('matkap') || n.includes('merdiven') || n.includes('vidalama') ||
      n.includes('boya tabancası') || n.includes('planya') || n.includes('kesme') || n.includes('kırıcı') ||
      n.includes('alet çanta') || n.includes('bosch') || n.includes('black & decker') || n.includes('black+decker') ||
      n.includes('cat ') || n.includes('mac allister'))
    return 'Ev';
  if (n.includes('saç') || n.includes('ütü') || n.includes('düzleştirici') || n.includes('fakir'))
    return 'Kozmetik';
  if (n.includes('ısıtıcı') || n.includes('süpürge') || n.includes('blender') || n.includes('su ısıtıcı') ||
      n.includes('karaca') || n.includes('zwilling') || n.includes('greenote') || n.includes('ultenic') ||
      n.includes('delonghi') || n.includes('veito'))
    return 'Ev';
  if (n.includes('squishmallow') || n.includes('oyun'))
    return 'Oyuncak';
  return 'Genel';
}

// Markayı çıkar
function getBrand(name) {
  const brands = [
    'Mac Allister','Philips','Asus','Samsung','Sony','SteelSeries','Razer','Kingston',
    'SanDisk','WD','Sandisk','Epson','TP-Link','Xiaomi','Thrustmaster','Karaca','Zwilling',
    'Fakir','DeLonghi','Greenote','Ultenic','ViewSonic','Cat','Black & Decker','Bosch',
    'Audio-Technica','AKG','Royal Kludge','Redragon','Creality','HP','Next','ERH','Squishmallows',
    'Teleskop Yayıncılık','İş Bankası','Redhouse Kidz','Alcatel','Veito','Manbox'
  ];
  for (const brand of brands) {
    if (name.toLowerCase().includes(brand.toLowerCase())) return brand;
  }
  return null;
}

// Excel'i oku
const wb = xlsx.readFile(EXCEL_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

console.log(`📂 Excel okundu: ${rows.length} ürün bulundu`);

// Veritabanına bağlan
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('❌ DB hatası:', err.message); process.exit(1); }
  console.log('✅ Veritabanına bağlandı\n');
});

const stmt = db.prepare(`
  INSERT OR IGNORE INTO products (name, image_url, description, category, brand, sku, tane_price, stock)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let added = 0, skipped = 0;

db.serialize(() => {
  rows.forEach((row, i) => {
    const sku = (row['HB Ürün Kodu (SKU)'] || '').trim();
    const name = (row['Ürün Adı'] || '').trim();
    if (!name) { skipped++; return; }

    const rawImageUrl = row['Görsel 1'] || row['Görsel 2'] || '';
    const imageUrl = rawImageUrl.replace('{size}', '800x800') || null;
    const description = stripHtml(row['Ürün Açıklaması']);
    const category = getCategory(name);
    const brand = getBrand(name);

    stmt.run(name, imageUrl, description, category, brand, sku || null, 0, 99, function(err) {
      if (err) {
        if (!err.message.includes('UNIQUE')) console.error(`❌ [${i+1}] ${name.substring(0,40)}: ${err.message}`);
        skipped++;
      } else if (this.changes > 0) {
        added++;
        console.log(`✅ [${i+1}] ${category.padEnd(12)} | ${name.substring(0, 55)}`);
      } else {
        skipped++;
        console.log(`⏭  [${i+1}] Zaten mevcut: ${name.substring(0, 55)}`);
      }
    });
  });

  stmt.finalize(() => {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${added} ürün eklendi`);
    console.log(`⏭  ${skipped} ürün atlandı (zaten mevcut veya hatalı)`);
    console.log(`💡 Admin panelinden fiyatları güncellemeyi unutma → http://localhost:3000/admin.html`);
    db.close();
  });
});
