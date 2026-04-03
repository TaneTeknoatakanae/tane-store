/**
 * TaneFiyat.xlsx ürünlerini veritabanına aktarır.
 * Kullanım: railway run node scripts/import-products.js
 */
require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- Excel'den çekilen ürün listesi (TaneFiyat.xlsx) ---
const EXCEL_PRODUCTS = [
  { price: 25999, url: 'https://www.amazon.com.tr/dp/B0F84JMZ88' },
  { price: 14999, url: 'https://www.amazon.com.tr/dp/B07792J6Q2' },
  { price: 109999, url: 'https://www.mediamarkt.com.tr/tr/product/_asus-tuf-gaming-f16-fx608jmr-rv066wintelr-coretm-i7-14650hx16-gb-ram1-tb-ssdrtx-506016w11-laptop-1247805.html' },
  { price: 11499, url: 'https://www.amazon.com.tr/dp/B0D6RTGFNC' },
  { price: 57999, url: 'https://www.mediamarkt.com.tr/tr/product/_bosch-bcrdw3b-robot-supurge-1252683.html' },
  { price: 26299, url: 'https://www.amazon.com.tr/dp/B098K2NBR4' },
  { price: 129999, url: 'https://www.mediamarkt.com.tr/tr/product/_casper-excalibur-g9151362-gq70a-c-13nesil-intelr-coretm-i7-13620h-islemci-48-gb-ram-1-tb-ssd-rtx-5070-8gb-gddr7-laptop-1249969.html' },
  { price: 55999, url: 'https://www.kurumsalit.com/urun/creality-cr-scan-otter-3d-tarayici' },
  { price: 6499, url: 'https://www.amazon.com.tr/dp/B09YGWMPRZ' },
  { price: 45999, url: 'https://www.amazon.com.tr/dp/B0CP1823DT' },
  { price: 7699, url: 'https://www.amazon.com.tr/dp/B0BVKZ4DLT' },
  { price: 7799, url: 'https://www.amazon.com.tr/dp/B0BVKZ4DLT' },
  { price: 10499, url: 'https://www.amazon.com.tr/dp/B0CZ6WM2LG' },
  { price: 12989, url: 'https://www.amazon.com.tr/dp/B07S61ZJCS' },
  { price: 7899, url: 'https://www.vatanbilgisayar.com/hp-smart-tank-589-fotokopi-tarayici-murekkep-tankli-yazici-4a8d9a.html' },
  { price: 2299, url: 'https://www.amazon.com.tr/dp/B09JSZYKYR' },
  { price: 3799, url: 'https://www.amazon.com.tr/dp/B0B57T5G5L' },
  { price: 10999, url: 'https://www.amazon.com.tr/dp/B09DVQ32XQ' },
  { price: 18299, url: 'https://www.amazon.com.tr/dp/B0D85LWJNF' },
  { price: 39999, url: 'https://www.mediamarkt.com.tr/tr/product/_krups-ea895-evidence-one-tam-otomatik-espresso-and-kahve-makinesi-gri-1228708.html' },
  { price: 41999, url: 'https://www.mediamarkt.com.tr/tr/product/_lenovo-ip-slim-3core-i5-13420h8512153w1183k100uftr-1251036.html' },
  { price: 87999, url: 'https://www.mediamarkt.com.tr/tr/product/_lenovo-yoga-slim-7snapdragon-x-plus-x1p-64-10016gb-ram512gb-ssd145w11laptop-83ed005gtr-1243368.html' },
  { price: 47170, url: 'https://www.mediamarkt.com.tr/tr/product/_lg-s95trdturllk-soundbar-1237503.html' },
  { price: 2800, url: 'https://www.koctas.com.tr/mac-allister-3-basamakli-genis-merdiven/p/2000033874' },
  { price: 49999, name: 'Meta Quest 3 512 GB', url: null },
  { price: 27499, url: 'https://www.amazon.com.tr/dp/B0FDLC8LBW' },
  { price: 7999, url: 'https://www.amazon.com.tr/dp/B0F93VMJ93' },
  { price: 3290, url: 'https://www.amazon.com.tr/dp/B0DVC6VVYW' },
  { price: 13999, url: 'https://www.amazon.com.tr/dp/B09XB651YV' },
  { price: 9499, url: 'https://www.amazon.com.tr/dp/B0D7VNP61V' },
  { price: 2690, url: 'https://www.sinerji.gen.tr/royal-kludge-r65-phantom-rgb-turkce-kablolu-gaming-klavye-p-55095' },
  { price: 54999, url: 'https://www.mediamarkt.com.tr/tr/product/_samsung-du7000-65-inc-163-ekran-4k-crystal-uhd-smart-led-tv-1236865.html' },
  { price: 2299, url: 'https://www.amazon.com.tr/dp/B0CV7SW5HX' },
  { price: 40999, url: 'https://www.ucuzbudur.com/sony-playstation-5-slim-dijital-edition-ps5-slim-konsol-ithaalatci-garantili' },
  { price: 15799, url: 'https://www.mediamarkt.com.tr/tr/product/_sony-pulse-elite-headset-w-case-kulak-ustu-kulaklik-beyaz-1251626.html' },
  { price: 7299, url: 'https://www.amazon.com.tr/dp/B0B5TR5CYX' },
  { price: 109999, url: 'https://www.mediamarkt.com.tr/tr/product/_tcl-65-inc-164-ekran-144hz-4k-qd-miniled-google-tv-1247308.html' },
  { price: 17999, url: 'https://www.amazon.com.tr/dp/B0CQXC59WD' },
  { price: 5499, url: 'https://www.amazon.com.tr/dp/B0DK9N47L7' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractJsonLdProduct($) {
  let product = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      let data = JSON.parse($(el).html() || '{}');
      if (!Array.isArray(data)) data = [data];
      const p = data.find(d => d && d['@type'] === 'Product');
      if (p && !product) product = p;
    } catch (_) {}
  });
  return product;
}

function extractImages(jsonLd) {
  if (!jsonLd) return [];
  const raw = jsonLd.image;
  if (!raw) return [];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.map(i => (typeof i === 'string' ? i : i?.url || i?.contentUrl || '')).filter(Boolean);
  if (typeof raw === 'object') {
    const u = raw.url || raw.contentUrl;
    if (Array.isArray(u)) return u.filter(Boolean);
    if (u) return [u];
  }
  return [];
}

function extractBrand(jsonLd, $, url) {
  if (jsonLd?.brand) {
    const b = jsonLd.brand;
    return typeof b === 'string' ? b : b?.name || '';
  }
  if (url && url.includes('amazon.com.tr')) {
    return $('#bylineInfo').text().trim().replace(/^(Marka:|Ziyaret edin|Visit the|by)\s*/i, '').trim();
  }
  return '';
}

function extractDescription(jsonLd, $, url) {
  if (jsonLd?.description && jsonLd.description.length > 20) return jsonLd.description.substring(0, 1000);
  if (url && url.includes('amazon.com.tr')) {
    const bullets = $('#feature-bullets ul li').map((_, el) => $(el).text().trim()).get().filter(t => t && !t.includes('Bu özellik')).join(' · ');
    if (bullets.length > 10) return bullets.substring(0, 1000);
    const desc = $('#productDescription p').text().trim();
    if (desc.length > 10) return desc.substring(0, 1000);
  }
  return '';
}

function guessCategory(name) {
  const n = (name || '').toLowerCase();
  if (/laptop|notebook|gaming laptop|bilgisayar|casper|lenovo|asus tuf/.test(n)) return 'Elektronik';
  if (/kulaklık|headset|kulaklik|pulse elite|kraken|blackshark/.test(n)) return 'Elektronik';
  if (/klavye|keyboard|mouse|fare|kludge/.test(n)) return 'Elektronik';
  if (/monitor|ekran|display|viewsonic/.test(n)) return 'Elektronik';
  if (/\btv\b|televizyon|smart led tv|samsung.*[0-9]" |tcl|next.*qled/.test(n)) return 'Elektronik';
  if (/robot süpürge|robot supurge|bosch bcrd|greenote/.test(n)) return 'Ev';
  if (/süpürge|supurge|revsv|black.*decker/.test(n)) return 'Ev';
  if (/kahve|espresso|krups|ariete/.test(n)) return 'Ev';
  if (/merdiven|mac allister/.test(n)) return 'Ev';
  if (/tıraş|traş|shaver|braun series/.test(n)) return 'Kişisel Bakım';
  if (/yazıcı|yazici|printer|laserjet|smart tank|dymo|etiket/.test(n)) return 'Elektronik';
  if (/ssd|nvme|disk|usb|flash|datatraveler|kingston/.test(n)) return 'Elektronik';
  if (/anakart|motherboard|gigabyte|b760|b650/.test(n)) return 'Elektronik';
  if (/projeksiyon|projektör|lazer ışık|alpd/.test(n)) return 'Elektronik';
  if (/kamera|camera|xiaomi.*kamera/.test(n)) return 'Elektronik';
  if (/playstation|ps5|quest|vr/.test(n)) return 'Elektronik';
  if (/soundbar|ses sistemi|lg.*s95/.test(n)) return 'Elektronik';
  if (/3d tarayıcı|3d scanner|creality/.test(n)) return 'Elektronik';
  if (/razer|gaming/.test(n)) return 'Elektronik';
  return 'Elektronik';
}

function guessBrandFromName(name) {
  const brands = ['ASUS', 'Samsung', 'LG', 'Sony', 'HP', 'Lenovo', 'Bosch', 'Braun', 'Kingston', 'Razer',
    'GIGABYTE', 'Casper', 'TCL', 'Next', 'Creality', 'DYMO', 'KRUPS', 'Ariete', 'Xiaomi', 'ViewSonic',
    'Black+Decker', 'Meta', 'Royal Kludge', 'Sinbo', 'Mac Allister', 'Philips', 'Greenote'];
  for (const b of brands) {
    if (name.toLowerCase().includes(b.toLowerCase())) return b;
  }
  return '';
}

async function scrapeProduct(url) {
  try {
    const resp = await axios.get(url, { headers: HEADERS, timeout: 20000 });
    const $ = cheerio.load(resp.data);
    const jsonLd = extractJsonLdProduct($);

    let name = (jsonLd?.name || '').trim();
    // Amazon: name from page title element if JSON-LD missing
    if (!name && url.includes('amazon.com.tr')) {
      name = ($('#productTitle').text() || '').trim();
    }
    if (!name) name = ($('h1').first().text() || '').trim();

    const images = extractImages(jsonLd);
    let image = images[0] || '';

    // Amazon: try to get main product image from HTML
    if (!image && url.includes('amazon.com.tr')) {
      image = $('#landingImage').attr('src') || $('#imgTagWrapperId img').attr('src') || '';
      // Try data-old-hires for higher res
      const hiRes = $('#landingImage').attr('data-old-hires');
      if (hiRes) image = hiRes;
    }
    if (!image && url.includes('mediamarkt.com.tr')) {
      image = $('img[class*="PDP"][class*="image"]').first().attr('src') ||
              $('picture img').first().attr('src') || '';
    }

    const description = extractDescription(jsonLd, $, url);
    const brand = extractBrand(jsonLd, $, url);

    return { name, description, image, images, brand };
  } catch (e) {
    return { name: '', description: '', image: '', images: [], brand: '', error: e.message };
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Tane Store — Ürün Aktarımı');
  console.log('='.repeat(60));

  // 1. Mevcut ürünleri sil
  console.log('\n[1/2] Mevcut ürünler siliniyor...');
  await pool.query('DELETE FROM products');
  console.log('  ✓ Tüm ürünler silindi.');

  // 2. Her ürünü scrape et ve ekle
  console.log(`\n[2/2] ${EXCEL_PRODUCTS.length} ürün aktarılıyor...\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < EXCEL_PRODUCTS.length; i++) {
    const p = EXCEL_PRODUCTS[i];
    console.log(`[${i + 1}/${EXCEL_PRODUCTS.length}] ${p.url ? new URL(p.url).hostname : 'manuel'} — ${p.price.toLocaleString('tr-TR')} ₺`);

    let scraped = { name: p.name || '', description: '', image: '', images: [], brand: '' };

    if (p.url) {
      scraped = await scrapeProduct(p.url);
      if (scraped.error) {
        console.log(`  ✗ Scraping hatası: ${scraped.error}`);
        scraped.name = scraped.name || p.name || '';
        failed++;
      } else {
        success++;
      }
    }

    const name = scraped.name || p.name || `Ürün ${i + 1}`;
    const brand = scraped.brand || guessBrandFromName(name);
    const category = guessCategory(name);
    const imagesJson = scraped.images.length > 0 ? JSON.stringify(scraped.images) : null;

    await pool.query(
      `INSERT INTO products (name, image_url, images, description, category, brand, tane_price, stock)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        name.substring(0, 500),
        scraped.image || null,
        imagesJson,
        scraped.description ? scraped.description.substring(0, 2000) : null,
        category,
        brand || null,
        p.price,
        10
      ]
    );

    console.log(`  ✓ Eklendi: "${name.substring(0, 60)}" | Kategori: ${category}${scraped.image ? ' | Görsel: var' : ''}`);

    // Rate limiting — Amazon ve diğer siteler için 1.5 saniye bekleme
    await sleep(1500);
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Tamamlandı! ${success} scrape başarılı, ${failed} URL erişilemedi.`);
  console.log('='.repeat(60));

  await pool.end();
}

main().catch(e => {
  console.error('Kritik hata:', e);
  process.exit(1);
});
