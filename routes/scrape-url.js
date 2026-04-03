const express = require('express');
const router = express.Router();
const adminAuth = require('../middleware/adminAuth');

// Puppeteer lazy-load — Railway'de cold start'ı yavaşlatmamak için
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = require('puppeteer').launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
             '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process']
    }).catch(e => { browserPromise = null; throw e; });
  }
  return browserPromise;
}

router.post('/', adminAuth, async (req, res) => {
  const { url } = req.body;
  if (!url || !/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Geçersiz URL' });

  let page;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'tr-TR,tr;q=0.9' });
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    // Wait a bit for lazy JS to render images
    await new Promise(r => setTimeout(r, 2500));

    const data = await page.evaluate(() => {
      // ── Name ──────────────────────────────────────────────
      const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';

      // JSON-LD product
      let jld = null;
      for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const d = JSON.parse(s.textContent);
          const arr = Array.isArray(d) ? d : [d];
          const p = arr.find(x => x && x['@type'] === 'Product');
          if (p) { jld = p; break; }
        } catch (_) {}
      }

      const name = (jld?.name || h1 || metaTitle || '').trim();

      // ── Brand ────────────────────────────────────────────
      const brand = (typeof jld?.brand === 'string' ? jld.brand : jld?.brand?.name) || '';

      // ── Description ──────────────────────────────────────
      // Prefer feature bullets (Amazon), then JSON-LD, then meta description
      let desc = '';
      const bullets = [...document.querySelectorAll('#feature-bullets li, .feature-bullets li')]
        .map(el => el.innerText.trim()).filter(t => t && t.length > 5 && !t.includes('Bu özelliği'));
      if (bullets.length > 0) {
        desc = bullets.map(b => '• ' + b).join('\n');
      } else if (jld?.description && jld.description.length > 20) {
        desc = jld.description;
      } else {
        desc = document.querySelector('meta[name="description"]')?.content || '';
      }
      desc = desc.substring(0, 2000);

      // ── Images ───────────────────────────────────────────
      const seen = new Set();
      const imgs = [];
      const push = (src) => {
        if (!src || seen.has(src)) return;
        // filter out tiny icons, base64, svg
        if (src.startsWith('data:') || src.endsWith('.svg') || src.includes('icon') || src.includes('logo')) return;
        // prefer large images
        seen.add(src);
        imgs.push(src);
      };

      // og:image
      push(document.querySelector('meta[property="og:image"]')?.content);

      // Amazon main + gallery
      const amzMain = document.querySelector('#landingImage, #imgTagWrapperId img');
      if (amzMain) {
        push(amzMain.getAttribute('data-old-hires') || amzMain.src);
        // Amazon thumbnail strip
        document.querySelectorAll('#altImages img, .imageThumbnail img').forEach(el => {
          const big = (el.getAttribute('data-a-dynamic-image') ? null : null);
          // try to upscale thumb URL
          let src = el.src || '';
          src = src.replace(/\._.*?_\./, '._AC_SL1500_.');
          push(src);
        });
      }

      // MediaMarkt / generic — find large img tags
      document.querySelectorAll('img').forEach(el => {
        const src = el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.src || '';
        const w = el.naturalWidth || el.width || parseInt(el.getAttribute('width') || '0');
        const h = el.naturalHeight || el.height || parseInt(el.getAttribute('height') || '0');
        if ((w >= 300 || h >= 300) && src) push(src);
      });

      // JSON-LD images
      const jldImgs = jld?.image;
      if (jldImgs) {
        const arr = Array.isArray(jldImgs) ? jldImgs : [jldImgs];
        arr.forEach(i => push(typeof i === 'string' ? i : i?.url || i?.contentUrl));
      }

      // ── Price ────────────────────────────────────────────
      let price = 0;
      if (jld?.offers) {
        const offer = Array.isArray(jld.offers) ? jld.offers[0] : jld.offers;
        price = parseFloat(offer?.price) || 0;
      }
      if (!price) {
        const priceEl = document.querySelector('.a-price-whole, [class*="price"], [class*="Price"], [itemprop="price"]');
        if (priceEl) {
          const raw = priceEl.getAttribute('content') || priceEl.innerText;
          price = parseFloat((raw || '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;
        }
      }

      return { name, brand, desc, imgs: imgs.slice(0, 12), price };
    });

    await page.close();
    res.json(data);

  } catch (e) {
    if (page) await page.close().catch(() => {});
    console.error('scrape-url hata:', e.message);
    res.status(500).json({ error: 'Sayfa açılamadı: ' + e.message.substring(0, 120) });
  }
});

module.exports = router;
