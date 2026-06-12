// ── Tek kaynaktan ortak içerik (framework'süz "partial" sistemi) ─────────────
// HTML dosyalarında <!--P:anahtar--> yazıldığında, sayfa servis edilirken
// aşağıdaki değerle değiştirilir. Böylece işletme bilgisi tek yerde durur.

const BUSINESS = {
  name:      'Tane Store',
  address:   'Atatürk Mah. Meriç Cad. C Blok 65. Ada Mimoza 3, Kapı No:17/C, Daire No:4, Ataşehir / İstanbul',
  phone:     '+90 532 362 37 30',
  phoneRaw:  '+905323623730',
  email:     'info@tanetekno.com',
  taxOffice: 'Kozyatağı Vergi Dairesi',
  taxNo:     '3280623883',
  hours:     'Hafta içi 09:00 – 18:00'
};

// Tüm site için tek, kendi içinde stilli footer (biz değerleri gömülü)
const FOOTER = `<style>
.tnf{background:#1C1814;color:#A89480;font-family:'Inter',-apple-system,sans-serif;font-size:13px;line-height:1.6;margin-top:48px}
.tnf-grid{max-width:1200px;margin:0 auto;padding:48px 24px 24px;display:grid;grid-template-columns:1.5fr 1fr 1fr 1.1fr;gap:32px}
.tnf a{color:#A89480;text-decoration:none}
.tnf a:hover{color:#FDFAF6}
.tnf-brand{font-weight:800;font-size:18px;color:#FDFAF6;margin-bottom:10px}
.tnf p{margin-bottom:8px}
.tnf-col-t{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#98989d;margin-bottom:14px}
.tnf-link{display:block;margin-bottom:9px;font-size:13px}
.tnf-accent{color:#C49660}
.tnf-bottom{border-top:1px solid #2a2420;max-width:1200px;margin:0 auto;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;font-size:11px;color:#6B5E50}
@media(max-width:760px){.tnf-grid{grid-template-columns:1fr 1fr}}
@media(max-width:460px){.tnf-grid{grid-template-columns:1fr}}
</style>
<footer class="tnf">
  <div class="tnf-grid">
    <div>
      <div class="tnf-brand">${BUSINESS.name}</div>
      <p style="max-width:260px;color:#98989d">Teknoloji ürünleri, 3D baskı ve lazer kesim/gravür hizmetleriyle güvenli alışveriş.</p>
      <p style="font-size:12px;color:#98989d">📍 ${BUSINESS.address}</p>
      <p style="font-size:12px;color:#98989d">📞 <a class="tnf-accent" href="tel:${BUSINESS.phoneRaw}">${BUSINESS.phone}</a> · ✉️ <a class="tnf-accent" href="mailto:${BUSINESS.email}">${BUSINESS.email}</a></p>
      <p style="font-size:12px;color:#98989d">Vergi No: ${BUSINESS.taxNo} · ${BUSINESS.taxOffice} · ${BUSINESS.hours}</p>
    </div>
    <div>
      <div class="tnf-col-t">Alışveriş</div>
      <a class="tnf-link" href="/">Tüm Ürünler</a>
      <a class="tnf-link tnf-accent" href="/3d-baski">🖨️ 3D Baskı Hizmeti</a>
      <a class="tnf-link tnf-accent" href="/lazer">⚡ Lazer Kesim & Gravür</a>
      <a class="tnf-link" href="/araclar">3D & Lazer Araçları</a>
      <a class="tnf-link" href="/kategori/bilgisayar">Bilgisayar</a>
      <a class="tnf-link" href="/kategori/hobi-muhendislik">Hobi & Mühendislik</a>
    </div>
    <div>
      <div class="tnf-col-t">Hizmet & Yardım</div>
      <a class="tnf-link" href="/track">Sipariş Takibi</a>
      <a class="tnf-link" href="/teslimat-iade">Teslimat & İade</a>
      <a class="tnf-link" href="/iletisim">İletişim</a>
      <a class="tnf-link" href="/hakkimizda">Hakkımızda</a>
      <a class="tnf-link" href="/hesabim">Hesabım</a>
    </div>
    <div>
      <div class="tnf-col-t">Yasal</div>
      <a class="tnf-link" href="/gizlilik">Gizlilik Politikası</a>
      <a class="tnf-link" href="/kullanim-sartlari">Kullanım Şartları</a>
      <a class="tnf-link" href="/mesafeli-satis">Mesafeli Satış Sözleşmesi</a>
      <a class="tnf-link" href="/on-bilgilendirme">Ön Bilgilendirme Formu</a>
      <a class="tnf-link" href="/kvkk">KVKK Aydınlatma</a>
      <a class="tnf-link" href="/cerez-politikasi">Çerez Politikası</a>
    </div>
  </div>
  <div class="tnf-bottom">
    <span>© 2026 ${BUSINESS.name} · Güvenli alışveriş, hızlı teslimat · PayTR ile ödeme</span>
    <span>🔒 SSL · 💳 3D Secure · 🚚 1–3 iş günü kargo · ↩️ 14 gün iade</span>
  </div>
</footer>`;

const PARTIALS = {
  'footer':        FOOTER,
  'biz.name':      BUSINESS.name,
  'biz.address':   BUSINESS.address,
  'biz.phone':     BUSINESS.phone,
  'biz.phoneRaw':  BUSINESS.phoneRaw,
  'biz.email':     BUSINESS.email,
  'biz.taxOffice': BUSINESS.taxOffice,
  'biz.taxNo':     BUSINESS.taxNo,
  'biz.tax':       `${BUSINESS.taxOffice} — ${BUSINESS.taxNo}`,
  'biz.hours':     BUSINESS.hours
};

// <!--P:anahtar--> işaretlerini değerleriyle değiştir (bilinmeyen anahtarı olduğu gibi bırakır)
function applyPartials(html) {
  return String(html).replace(/<!--P:([\w.]+)-->/g, (m, key) =>
    Object.prototype.hasOwnProperty.call(PARTIALS, key) ? PARTIALS[key] : m
  );
}

module.exports = { BUSINESS, PARTIALS, applyPartials };
