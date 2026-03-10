const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');

// Kayıt ol
router.post('/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Ad, e-posta ve şifre zorunlu' });
  if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı' });

  try {
    const hash = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (name, email, password_hash, phone) VALUES (?, ?, ?, ?)',
      [name.trim(), email.trim().toLowerCase(), hash, phone || null],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı' });
          return res.status(500).json({ error: err.message });
        }
        req.session.userId = this.lastID;
        req.session.userName = name.trim();
        res.json({ id: this.lastID, name: name.trim(), email: email.trim().toLowerCase() });
      }
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Giriş yap
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-posta ve şifre zorunlu' });

  db.get('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'E-posta veya şifre hatalı' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'E-posta veya şifre hatalı' });

    req.session.userId = user.id;
    req.session.userName = user.name;
    res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, address: user.address, city: user.city });
  });
});

// Çıkış yap
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Çıkış yapıldı' }));
});

// Mevcut kullanıcı
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  db.get('SELECT id, name, email, phone, address, city, created_at FROM users WHERE id = ?',
    [req.session.userId], (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: 'Kullanıcı bulunamadı' });
      res.json(user);
    });
});

// Profil güncelle
router.put('/profile', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  const { name, phone, address, city } = req.body;
  db.run(
    'UPDATE users SET name = ?, phone = ?, address = ?, city = ? WHERE id = ?',
    [name, phone || null, address || null, city || null, req.session.userId],
    err => {
      if (err) return res.status(500).json({ error: err.message });
      req.session.userName = name;
      res.json({ message: '✅ Profil güncellendi' });
    }
  );
});

// Şifre değiştir
router.put('/password', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Giriş yapılmamış' });
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Eksik bilgi' });
  if (new_password.length < 6) return res.status(400).json({ error: 'Yeni şifre en az 6 karakter olmalı' });

  db.get('SELECT password_hash FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Mevcut şifre hatalı' });
    const hash = await bcrypt.hash(new_password, 10);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.session.userId], err2 => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: '✅ Şifre güncellendi' });
    });
  });
});

module.exports = router;
