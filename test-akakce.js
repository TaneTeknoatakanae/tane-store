const axios = require('axios');
const cheerio = require('cheerio');

async function testHB(sku) {
  const url = `https://www.hepsiburada.com/${sku}-pm-`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept-Language': 'tr-TR,tr;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000,
      maxRedirects: 5
    });
    const $ = cheerio.load(data);
    console.log('HB OK, uzunluk:', data.length);
    // Fiyat ara
    const price = $('[class*="price"], [itemprop="price"], [data-bind*="price"]').first().text().trim();
    console.log('Fiyat elementi:', price.slice(0,100));
  } catch(e) {
    console.log('HB hata:', e.response?.status, e.message);
  }
}

async function testAkakce(name) {
  // Akakce search API endpoint denemesi
  const endpoints = [
    `https://www.akakce.com/search/?q=${encodeURIComponent(name)}`,
    `https://api.akakce.com/search?q=${encodeURIComponent(name)}`,
    `https://m.akakce.com/arama/?q=${encodeURIComponent(name)}`
  ];

  for (const url of endpoints) {
    try {
      const { data, status } = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
          'Accept-Language': 'tr-TR,tr;q=0.9',
          'Accept': 'text/html,*/*;q=0.8'
        },
        timeout: 10000,
        validateStatus: () => true
      });
      console.log(url, '→ status:', status, 'uzunluk:', data.length);
      if (status === 200 && data.length > 500) {
        const $ = cheerio.load(data);
        $('*').each((i, el) => {
          const t = $(el).text().replace(/\s+/g,' ').trim();
          if (t.match(/\d+\.?\d*,\d{2}\s*TL/) && t.length < 200) {
            console.log('  FIYAT BULUNDU:', t.slice(0,150));
          }
        });
        break;
      }
    } catch(e) {
      console.log(url, '→ hata:', e.message);
    }
  }
}

(async () => {
  console.log('=== Akakce testi ===');
  await testAkakce('Steelseries Aerox 9');
  console.log('\n=== HB testi ===');
  await testHB('HBCV0000055D3D');
})();
