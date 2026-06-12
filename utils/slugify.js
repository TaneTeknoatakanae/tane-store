// Türkçe karakter uyumlu, SEO-dostu slug üretici
// "Bambu Lab X1E Combo 3D Yazıcı" → "bambu-lab-x1e-combo-3d-yazici"
const TR = { 'ç':'c','Ç':'c','ğ':'g','Ğ':'g','ı':'i','İ':'i','ö':'o','Ö':'o','ş':'s','Ş':'s','ü':'u','Ü':'u','â':'a','Â':'a','î':'i','Î':'i','û':'u','Û':'u' };

function slugify(str) {
  let s = String(str || '')
    .replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g, m => TR[m] || m)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')   // harf/rakam dışını tireye çevir
    .replace(/^-+|-+$/g, '')        // baş/son tireleri at
    .replace(/-{2,}/g, '-');        // ardışık tireleri tekille
  // ~70 karakterde kelime sınırından kes
  if (s.length > 70) {
    s = s.substring(0, 70).replace(/-[^-]*$/, '');
  }
  return s || 'urun';
}

module.exports = { slugify };
