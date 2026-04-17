/**
 * automations.js
 *
 * Otomatik görevler:
 * 1) Stok 0 olan ürünleri pasife al (her saat)
 * 2) Rakip fiyat takibi — prices tablosundaki platformlardan fiyat karşılaştırması (günlük)
 * 3) Fiyat düşüş bildirimi — Telegram bot (opsiyonel, TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID gerekli)
 */

const db = require('./database/db');

// ─── 1) Stok 0 → otomatik pasif ───────────────────────────────────
async function autoDeactivateOutOfStock() {
  return new Promise((resolve) => {
    db.run(
      `UPDATE products SET is_active = FALSE WHERE stock <= 0 AND is_active = TRUE`,
      [],
      function (err) {
        if (err) {
          console.error('[auto-deactivate] DB hata:', err.message);
          return resolve(0);
        }
        if (this.changes > 0) {
          console.log(`[auto-deactivate] ${this.changes} ürün stok 0 → pasife alındı`);
        }
        resolve(this.changes);
      }
    );
  });
}

// ─── 2) Rakip fiyat takip + otomatik güncelleme ───────────────────
// prices tablosundaki tüm platform fiyatlarını kontrol eder
// Eğer rakip fiyat düştüyse ve bizden ucuzsa → %5 altında fiyat güncelle
async function competitorPriceCheck() {
  return new Promise((resolve) => {
    db.all(`
      SELECT p.id, p.name, p.tane_price, p.discount_price,
             pr.platform, pr.price AS competitor_price, pr.url AS competitor_url
      FROM products p
      JOIN prices pr ON pr.product_id = p.id
      WHERE p.is_active = TRUE AND pr.price > 0
      ORDER BY p.id
    `, [], async (err, rows) => {
      if (err) {
        console.error('[price-check] DB hata:', err.message);
        return resolve({ checked: 0, updated: 0, alerts: [] });
      }

      const alerts = [];
      let updated = 0;
      const autoUpdate = process.env.AUTO_PRICE_UPDATE === '1';
      const margin = parseFloat(process.env.PRICE_MARGIN || '0.05'); // %5 varsayılan

      // Ürün bazında grupla
      const byProduct = {};
      (rows || []).forEach(r => {
        if (!byProduct[r.id]) byProduct[r.id] = { ...r, competitors: [] };
        byProduct[r.id].competitors.push({ platform: r.platform, price: r.competitor_price, url: r.competitor_url });
      });

      for (const pid of Object.keys(byProduct)) {
        const prod = byProduct[pid];
        const ourPrice = prod.discount_price || prod.tane_price;
        const cheapestCompetitor = prod.competitors.reduce((min, c) => c.price < min.price ? c : min, prod.competitors[0]);

        if (!cheapestCompetitor) continue;

        // Rakip bizden ucuzsa
        if (cheapestCompetitor.price < ourPrice) {
          const diff = ourPrice - cheapestCompetitor.price;
          const pct = Math.round((diff / ourPrice) * 100);

          alerts.push({
            product: prod.name,
            our_price: ourPrice,
            competitor: cheapestCompetitor.platform,
            competitor_price: cheapestCompetitor.price,
            diff,
            pct
          });

          // Otomatik fiyat güncelleme: rakipten %margin ucuz ol
          if (autoUpdate) {
            const newPrice = Math.round(cheapestCompetitor.price * (1 - margin));
            if (newPrice > 0 && newPrice < ourPrice) {
              await new Promise(r => {
                db.run(
                  `UPDATE products SET discount_price = $1 WHERE id = $2`,
                  [newPrice, prod.id],
                  function (err2) {
                    if (!err2 && this.changes > 0) {
                      console.log(`[price-check] 💰 ${prod.name.substring(0, 40)} — ${ourPrice}₺ → ${newPrice}₺ (rakip: ${cheapestCompetitor.price}₺ ${cheapestCompetitor.platform})`);
                      updated++;
                    }
                    r();
                  }
                );
              });
            }
          }
        }
      }

      if (alerts.length > 0) {
        console.log(`[price-check] ⚠️ ${alerts.length} üründe rakip daha ucuz:`);
        alerts.forEach(a => {
          console.log(`  → ${a.product.substring(0, 40)} | Biz: ${a.our_price}₺ | ${a.competitor}: ${a.competitor_price}₺ (-%${a.pct})`);
        });

        // Telegram bildirimi
        await sendTelegramAlert(alerts);
      } else {
        console.log('[price-check] ✅ Tüm ürünlerde fiyat avantajı korunuyor');
      }

      resolve({ checked: Object.keys(byProduct).length, updated, alerts });
    });
  });
}

// ─── 3) Telegram bildirim ──────────────────────────────────────────
async function sendTelegramAlert(alerts) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const axios = require('axios');
  let msg = `🔔 *Tane Store — Fiyat Alarmı*\n\n`;
  msg += `${alerts.length} üründe rakip daha ucuz:\n\n`;
  alerts.slice(0, 10).forEach(a => {
    msg += `• *${a.product.substring(0, 35)}*\n`;
    msg += `  Biz: ${a.our_price.toLocaleString('tr-TR')}₺ → ${a.competitor}: ${a.competitor_price.toLocaleString('tr-TR')}₺ (-%${a.pct})\n\n`;
  });
  if (alerts.length > 10) msg += `... ve ${alerts.length - 10} ürün daha\n`;

  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: msg,
      parse_mode: 'Markdown'
    });
    console.log('[telegram] Fiyat alarmı gönderildi');
  } catch (e) {
    console.error('[telegram] Gönderilemedi:', e.message);
  }
}

// ─── Export ────────────────────────────────────────────────────────
module.exports = {
  autoDeactivateOutOfStock,
  competitorPriceCheck,
  sendTelegramAlert
};
