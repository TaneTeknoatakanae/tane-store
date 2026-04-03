/**
 * price-compare.js — Tane Store piyasa fiyatları bileşeni
 * Güvenli eklenti: mevcut hiçbir elemanı değiştirmez.
 * Bu dosyayı kaldırmak siteyi etkilemez.
 */
(function () {
  'use strict';

  function getSku() {
    // product.html?id=123 — SKU'yu data attribute veya meta'dan çek
    var el = document.querySelector('[data-sku]');
    if (el) return el.getAttribute('data-sku');
    var meta = document.querySelector('meta[name="product-sku"]');
    if (meta) return meta.getAttribute('content');
    return null;
  }

  function getProductId() {
    var params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    } catch (e) { return iso; }
  }

  function formatPrice(n) {
    return Number(n).toLocaleString('tr-TR') + ' ₺';
  }

  function render(data, ourPrice) {
    // Find anchor — inject AFTER the price element, never replace it
    var anchor =
      document.querySelector('.prod-price') ||
      document.querySelector('[class*="price"]') ||
      document.querySelector('.price');
    if (!anchor) return;

    // Don't inject twice
    if (document.getElementById('tane-price-compare')) return;

    var rows = [];
    if (data.hepsiburada) {
      rows.push('<div class="tpc-row"><span class="tpc-seller">Hepsiburada</span><span class="tpc-val">' + formatPrice(data.hepsiburada) + '</span></div>');
    }
    if (data.trendyol) {
      rows.push('<div class="tpc-row"><span class="tpc-seller">Trendyol</span><span class="tpc-val">' + formatPrice(data.trendyol) + '</span></div>');
    }
    if (!rows.length) return;

    if (ourPrice) {
      rows.push('<div class="tpc-row tpc-ours"><span class="tpc-seller">Tane Store</span><span class="tpc-val">' + formatPrice(ourPrice) + ' <span class="tpc-best">✅</span></span></div>');
    }

    var box = document.createElement('div');
    box.id = 'tane-price-compare';
    box.innerHTML =
      '<style>' +
      '#tane-price-compare{margin-top:16px;padding:14px 16px;background:#f8f4ef;border:1px solid #e8ddd0;border-radius:12px;font-family:inherit}' +
      '#tane-price-compare .tpc-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#a89480;margin-bottom:10px}' +
      '#tane-price-compare .tpc-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #ede4d4;font-size:14px}' +
      '#tane-price-compare .tpc-row:last-child{border-bottom:none}' +
      '#tane-price-compare .tpc-seller{color:#6b5e50}' +
      '#tane-price-compare .tpc-val{font-weight:600;color:#1c1814}' +
      '#tane-price-compare .tpc-ours .tpc-seller{color:#1c1814;font-weight:700}' +
      '#tane-price-compare .tpc-ours .tpc-val{color:#c49660}' +
      '#tane-price-compare .tpc-best{font-size:12px}' +
      '#tane-price-compare .tpc-footer{font-size:11px;color:#aaa;margin-top:10px}' +
      '</style>' +
      '<div class="tpc-title">Piyasa Fiyatları</div>' +
      rows.join('') +
      '<div class="tpc-footer">Son güncelleme: ' + formatDate(data.last_updated) + ' · Fiyatlar bilgilendirme amaçlıdır, değişiklik gösterebilir.</div>';

    anchor.parentNode.insertBefore(box, anchor.nextSibling);
  }

  function init() {
    var productId = getProductId();
    var sku = getSku();
    if (!productId && !sku) return;

    // Fetch price-data.json — fail silently on any error
    fetch('/price-data.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (allData) {
        if (!allData) return;

        // Match by SKU or product id
        var entry = null;
        if (sku && allData[sku] && allData[sku].approved) entry = allData[sku];
        if (!entry && productId) {
          // Fallback: find entry by product_id field
          var keys = Object.keys(allData);
          for (var i = 0; i < keys.length; i++) {
            var d = allData[keys[i]];
            if (String(d.product_id) === String(productId) && d.approved) { entry = d; break; }
          }
        }
        if (!entry) return;

        // Get our price from page
        var ourPrice = null;
        var priceEl = document.querySelector('.prod-price, [data-price]');
        if (priceEl) {
          var raw = priceEl.getAttribute('data-price') || priceEl.textContent;
          var parsed = parseFloat((raw || '').replace(/[^\d,]/g, '').replace(',', '.'));
          if (parsed > 0) ourPrice = parsed;
        }

        render(entry, ourPrice);
      })
      .catch(function () { /* fail silently */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
