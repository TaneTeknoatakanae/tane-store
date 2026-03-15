const db = require('../database/db');

const ADMIN_SESSION_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

// ── Audit log helper ────────────────────────────────────────────────────────
function audit(req, action, details = {}) {
  try {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    db.run(
      'INSERT INTO admin_audit_log (action, details, ip) VALUES (?, ?, ?)',
      [action, JSON.stringify(details), ip]
    );
  } catch (e) { /* never throw from audit */ }
}

// ── Admin session auth + CSRF check ────────────────────────────────────────
function adminAuth(req, res, next) {
  if (!req.session || !req.session.isAdmin) {
    return res.status(401).json({ error: 'Yetkisiz erişim. Giriş yapınız.' });
  }

  // Session timeout check
  if (Date.now() - (req.session.adminLoginTime || 0) > ADMIN_SESSION_TIMEOUT) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Oturum süresi doldu. Lütfen tekrar giriş yapınız.' });
  }

  // CSRF check for state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const token = req.headers['x-csrf-token'];
    if (!token || token !== req.session.csrfToken) {
      return res.status(403).json({ error: 'Geçersiz güvenlik tokeni.' });
    }
  }

  next();
}

adminAuth.audit = audit;
module.exports = adminAuth;
