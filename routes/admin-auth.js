const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../database/db');
const adminAuth = require('../middleware/adminAuth');
const { audit } = adminAuth;

const ADMIN_SESSION_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours

// ── POST /api/admin/login ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password, totp } = req.body || {};

  const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
  const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
    return res.status(503).json({ error: 'Admin kimlik bilgileri sunucuda yapılandırılmamış.' });
  }

  // Generic error — never reveal which field is wrong
  const fail = (reason) => {
    audit(req, 'admin.login.fail', { reason });
    return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
  };

  if (!username || !password) return fail('missing_fields');
  if (username !== ADMIN_USERNAME) return fail('invalid_username');

  const valid = await bcrypt.compare(String(password), ADMIN_PASSWORD_HASH).catch(() => false);
  if (!valid) return fail('invalid_password');

  // ── TOTP 2FA (only if ADMIN_2FA_SECRET env var is set) ───────────────────
  if (process.env.ADMIN_2FA_SECRET) {
    const speakeasy = require('speakeasy');
    if (!totp) {
      return res.status(401).json({ error: 'Doğrulama kodu gerekli.', require2fa: true });
    }
    const ok = speakeasy.totp.verify({
      secret: process.env.ADMIN_2FA_SECRET,
      encoding: 'base32',
      token: String(totp),
      window: 1
    });
    if (!ok) {
      audit(req, 'admin.login.fail_2fa', {});
      return res.status(401).json({ error: 'Geçersiz doğrulama kodu.', require2fa: true });
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────
  const csrfToken = crypto.randomBytes(32).toString('hex');
  req.session.isAdmin = true;
  req.session.adminLoginTime = Date.now();
  req.session.csrfToken = csrfToken;
  req.session.cookie.maxAge = ADMIN_SESSION_TIMEOUT;

  audit(req, 'admin.login.success', {});
  req.session.save(err => {
    if (err) return res.status(500).json({ error: 'Oturum kaydedilemedi.' });
    res.json({ ok: true });
  });
});

// ── POST /api/admin/logout ──────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  audit(req, 'admin.logout', {});
  req.session.destroy(() => res.json({ ok: true }));
});

// ── GET /api/admin/me — returns auth status + CSRF token ───────────────────
router.get('/me', adminAuth, (req, res) => {
  res.json({ admin: true, csrfToken: req.session.csrfToken });
});

// ── GET /api/admin/setup-2fa — generate a new TOTP secret ─────────────────
// Call this once, set ADMIN_2FA_SECRET env var to the returned base32 secret,
// then scan the otpauthUrl with any authenticator app (Google Auth, Authy, etc.)
router.get('/setup-2fa', adminAuth, (req, res) => {
  const speakeasy = require('speakeasy');
  const secret = speakeasy.generateSecret({ name: 'Tane Store Admin', length: 20 });
  res.json({
    base32: secret.base32,
    otpauthUrl: secret.otpauth_url,
    instructions: [
      '1. Bu endpoint\'i sadece bir kez çağırın.',
      '2. base32 değerini ADMIN_2FA_SECRET ortam değişkenine ekleyin.',
      '3. otpauthUrl\'yi bir QR kod oluşturucuya yapıştırın (örn. qr-code-generator.com)',
      '4. Authenticator uygulamanızla QR\'ı tarayın.',
      '5. Bir sonraki giriş denemesinde 6 haneli kod istenecek.'
    ].join('\n')
  });
});

// ── GET /api/admin/audit — last 100 audit events ──────────────────────────
router.get('/audit', adminAuth, (req, res) => {
  db.all(
    'SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT 100',
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

module.exports = router;
