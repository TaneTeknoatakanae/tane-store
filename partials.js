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

const PARTIALS = {
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
