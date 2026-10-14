/**
 * ============================================================================
 * SERVER UTAMA TUR VIRTUAL 360° INTERAKTIF & SISTEM MANAJEMEN BERBASIS GRAF
 * ============================================================================
 * Arsitektur: Node.js (ES Modules), Express.js, Prisma ORM (SQLite), Multer
 * Standar: Production-Ready (cPanel / Phusion Passenger / VPS / Localhost)
 * Fitur: Otentikasi JWT + Bcrypt, Analisis Teori Graf (Digraph BFS), Normalisasi cPanel
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tur360_secure_production_secret_key_2026';
const IS_PROD = process.env.NODE_ENV === 'production';

// ============================================================================
// 1. MANAJEMEN DIREKTORI PENYIMPANAN BERKAS (UPLOADS)
// ============================================================================
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ============================================================================
// 2. KONFIGURASI MULTER UNTUK FOTO PANORAMA 360 & LOGO
// ============================================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const basename = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 35);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const finalExt = ext === '.insp' ? '.insp' : (ext || '.jpg');
    cb(null, `${basename}-${uniqueSuffix}${finalExt}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.insp', '.svg'];

  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error('Format berkas tidak didukung. Harap unggah format gambar (.jpg, .png, .webp, .svg) atau panorama .insp'),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 40 * 1024 * 1024, // Maksimal 40MB per foto panorama 360
  },
});

// ============================================================================
// 3. IN-MEMORY RATE LIMITER SEDERHANA (MENCEGAH BRUTE-FORCE PADA ENDPOINT LOGIN)
// ============================================================================
const loginAttemptTracker = new Map();
const checkLoginRateLimit = (req, res, next) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 Menit
  const maxAttempts = 8;           // Maksimal 8 kali kegagalan per IP

  const record = loginAttemptTracker.get(clientIp);
  if (record) {
    if (now - record.firstAttempt < windowMs) {
      if (record.count >= maxAttempts) {
        return res.status(429).json({
          success: false,
          message: 'Terlalu banyak percobaan login yang gagal. Akun dinas diamankan sementara selama 15 menit.',
        });
      }
    } else {
      loginAttemptTracker.set(clientIp, { count: 0, firstAttempt: now });
    }
  } else {
    loginAttemptTracker.set(clientIp, { count: 0, firstAttempt: now });
  }
  next();
};

const registerFailedLogin = (ip) => {
  const record = loginAttemptTracker.get(ip);
  if (record) {
    record.count += 1;
  }
};

const resetLoginAttempts = (ip) => {
  loginAttemptTracker.delete(ip);
};

// ============================================================================
// 4. MIDDLEWARE GLOBAL & SECURITY HEADERS
// ============================================================================
app.use((req, res, next) => {
  // Security Headers Esensial
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ============================================================================
// 5. MIDDLEWARE NORMALISASI BASE PATH cPanel (/tur360)
// ============================================================================
app.use((req, res, next) => {
  const original = req.originalUrl || req.url || '';
  const isTur360 =
    original.startsWith('/tur360') ||
    req.url.startsWith('/tur360') ||
    Boolean(req.headers['x-forwarded-uri'] && req.headers['x-forwarded-uri'].startsWith('/tur360'));

  req.isTur360 = isTur360;
  req.appBase = isTur360 ? '/tur360' : '';

  if (req.url === '/tur360') {
    req.url = '/';
  } else if (req.url.startsWith('/tur360/')) {
    req.url = req.url.substring('/tur360'.length) || '/';
  }
  next();
});

// ============================================================================
// 6. CACHING & STATIC FILE SERVING
// ============================================================================
const staticCacheConfig = {
  maxAge: 365 * 24 * 60 * 60 * 1000, // 1 Tahun untuk file statis immutable
  etag: true,
  lastModified: true,
  acceptRanges: true,
  setHeaders: (res, filePath) => {
    if (filePath.match(/\.(jpg|jpeg|png|webp|insp|css|js|woff2?|svg)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  },
};

// Tangani berkas .insp agar WebGL / Pannellum mengenalinya sebagai gambar jpeg
app.use('/uploads', (req, res, next) => {
  if (req.path.toLowerCase().endsWith('.insp')) {
    res.setHeader('Content-Type', 'image/jpeg');
  }
  next();
}, express.static(uploadsDir, staticCacheConfig));

app.use(express.static(path.join(__dirname, 'public'), staticCacheConfig));
app.use('/views', express.static(path.join(__dirname, 'views')));

// Fallback rute prefix subfolder cPanel langsung
app.use('/tur360/uploads', (req, res, next) => {
  if (req.path.toLowerCase().endsWith('.insp')) {
    res.setHeader('Content-Type', 'image/jpeg');
  }
  next();
}, express.static(uploadsDir, staticCacheConfig));
app.use('/tur360/static', express.static(path.join(__dirname, 'public', 'static'), staticCacheConfig));
app.use('/tur360/views', express.static(path.join(__dirname, 'views')));

// ============================================================================
// 7. MIDDLEWARE OTENTIKASI ADMINISTRATOR DINAS (JWT)
// ============================================================================
const authenticateAdmin = (req, res, next) => {
  const token =
    req.cookies.admin_token ||
    (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Akses ditolak: Silakan login terlebih dahulu sebagai administrator dinas.',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      message: 'Sesi login tidak valid atau telah kedaluwarsa. Silakan login kembali.',
    });
  }
};

// ============================================================================
// 8. RUTE UTAMA & VIEW TEMPLATE
// ============================================================================
app.get(['/', '/tur360', '/tur360/'], async (req, res) => {
  const basePrefix = req.appBase || (req.isTur360 ? '/tur360' : '');
  try {
    const firstDest = await prisma.destination.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    if (firstDest) {
      return res.redirect(`${basePrefix}/tour/${firstDest.slug}`);
    }
    return res.redirect(`${basePrefix}/admin`);
  } catch (error) {
    res.sendFile(path.join(__dirname, 'views', 'tour.html'));
  }
});

app.get(['/tour/:slug', '/tur360/tour/:slug', '/tour', '/tur360/tour'], (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'tour.html'));
});

app.get(['/admin', '/tur360/admin'], (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// ============================================================================
// 9. API: OTENTIKASI & MANAJEMEN SESI ADMIN
// ============================================================================
app.post('/api/auth/login', checkLoginRateLimit, async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username dan kata sandi wajib diisi.',
      });
    }

    const cleanUsername = String(username).trim().toLowerCase();
    const admin = await prisma.adminUser.findUnique({
      where: { username: cleanUsername },
    });

    if (!admin) {
      registerFailedLogin(clientIp);
      return res.status(401).json({
        success: false,
        message: 'Nama pengguna atau kata sandi tidak cocok.',
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      registerFailedLogin(clientIp);
      return res.status(401).json({
        success: false,
        message: 'Nama pengguna atau kata sandi tidak cocok.',
      });
    }

    resetLoginAttempts(clientIp);

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('admin_token', token, {
      httpOnly: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: IS_PROD,
    });

    return res.json({
      success: true,
      message: 'Login berhasil! Selamat datang di Panel Administrator.',
      token,
      user: { id: admin.id, username: admin.username },
    });
  } catch (error) {
    console.error('Error saat login:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan sistem saat memproses login.',
    });
  }
});

app.get('/api/auth/me', authenticateAdmin, (req, res) => {
  return res.json({
    success: true,
    user: req.admin,
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('admin_token', { path: '/' });
  return res.json({
    success: true,
    message: 'Anda berhasil keluar dari sistem.',
  });
});

// ============================================================================
// 10. API: MANAJEMEN AKUN ADMIN DINAS (CRUD)
// ============================================================================
app.get('/api/admin-users', authenticateAdmin, async (req, res) => {
  try {
    const users = await prisma.adminUser.findMany({
      select: { id: true, username: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return res.json({ success: true, users });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin-users', authenticateAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan kata sandi wajib diisi.' });
    }

    const cleanUsername = username.trim().toLowerCase();
    if (cleanUsername.length < 3) {
      return res.status(400).json({ success: false, message: 'Username minimal 3 karakter.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Kata sandi minimal 6 karakter demi keamanan akun dinas.' });
    }

    const existing = await prisma.adminUser.findUnique({ where: { username: cleanUsername } });
    if (existing) {
      return res.status(400).json({ success: false, message: `Username "${cleanUsername}" sudah digunakan.` });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const newUser = await prisma.adminUser.create({
      data: { username: cleanUsername, password_hash },
      select: { id: true, username: true, createdAt: true, updatedAt: true },
    });

    return res.status(201).json({
      success: true,
      message: `Akun admin dinas "${newUser.username}" berhasil dibuat!`,
      user: newUser,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/admin-users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password } = req.body;

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Akun admin tidak ditemukan.' });
    }

    const updateData = {};
    if (username && username.trim() !== '') {
      const cleanUsername = username.trim().toLowerCase();
      if (cleanUsername !== existing.username) {
        const taken = await prisma.adminUser.findUnique({ where: { username: cleanUsername } });
        if (taken) {
          return res.status(400).json({ success: false, message: `Username "${cleanUsername}" sudah digunakan akun lain.` });
        }
        updateData.username = cleanUsername;
      }
    }

    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Kata sandi baru minimal 6 karakter.' });
      }
      updateData.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada data perubahan yang dikirim.' });
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: updateData,
      select: { id: true, username: true, createdAt: true, updatedAt: true },
    });

    return res.json({
      success: true,
      message: `Akun admin "${updated.username}" berhasil diperbarui.`,
      user: updated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin-users/:id', authenticateAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const totalAdmins = await prisma.adminUser.count();
    if (totalAdmins <= 1) {
      return res.status(400).json({ success: false, message: 'Sistem harus menyisakan minimal satu akun admin utama.' });
    }

    if (req.admin && req.admin.id === id) {
      return res.status(400).json({ success: false, message: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.' });
    }

    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) {
      return res.status(404).json({ success: false, message: 'Akun tidak ditemukan.' });
    }

    await prisma.adminUser.delete({ where: { id } });
    return res.json({ success: true, message: `Akun "${target.username}" berhasil dihapus.` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 11. API: PENGATURAN IDENTITAS SISTEM & LOGO (PERSISTEN DATABASE SQLITE)
// ============================================================================
const getSystemSettings = async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT "key", "value", "updatedAt" FROM "SystemSetting"`);
    if (Array.isArray(rows) && rows.length > 0) {
      const dbSettings = {
        appTitle: 'Panel Administrator',
        appSubtitle: 'Kelola data tur virtual 360° interaktif',
        logoUrl: '',
        updatedAt: Date.now(),
      };
      rows.forEach((r) => {
        dbSettings[r.key] = r.value;
        if (r.updatedAt) {
          dbSettings.updatedAt = new Date(r.updatedAt).getTime();
        }
      });
      return dbSettings;
    }
  } catch (err) {}

  return {
    appTitle: 'Panel Administrator',
    appSubtitle: 'Kelola data tur virtual 360° interaktif',
    logoUrl: '',
    updatedAt: Date.now(),
  };
};

app.get(['/api/system/settings', '/tur360/api/system/settings'], async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  const settings = await getSystemSettings();
  return res.json({ success: true, settings });
});

app.put(['/api/system/settings', '/tur360/api/system/settings'], async (req, res) => {
  try {
    const { appTitle, appSubtitle, logoUrl } = req.body;
    const current = await getSystemSettings();
    const updated = {
      appTitle: (appTitle !== undefined && appTitle !== null && String(appTitle).trim() !== '')
        ? String(appTitle).trim()
        : current.appTitle,
      appSubtitle: (appSubtitle !== undefined && appSubtitle !== null)
        ? String(appSubtitle).trim()
        : current.appSubtitle,
      logoUrl: (logoUrl !== undefined && logoUrl !== null) ? String(logoUrl).trim() : '',
      updatedAt: Date.now(),
    };

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SystemSetting" (
        "key" TEXT NOT NULL PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES ('appTitle', ?, CURRENT_TIMESTAMP)
      ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
    `, updated.appTitle);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES ('appSubtitle', ?, CURRENT_TIMESTAMP)
      ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
    `, updated.appSubtitle);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "SystemSetting" ("key", "value", "updatedAt") VALUES ('logoUrl', ?, CURRENT_TIMESTAMP)
      ON CONFLICT("key") DO UPDATE SET "value" = excluded."value", "updatedAt" = CURRENT_TIMESTAMP;
    `, updated.logoUrl);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({
      success: true,
      message: 'Identitas dan logo panel administrator berhasil disimpan ke database!',
      settings: updated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 12. API: UNGGAH GAMBAR PANORAMA & LOGO (MULTER)
// ============================================================================
app.post('/api/upload', upload.single('panorama'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada berkas yang diunggah. Silakan pilih foto panorama 360.',
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    return res.json({
      success: true,
      message: 'Berkas berhasil diunggah ke server.',
      url: fileUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal mengunggah berkas: ' + error.message,
    });
  }
});

// ============================================================================
// 13. API: FORMAT KHUSUS VIEWER PANNELLUM 360°
// ============================================================================
app.get(['/api/tour', '/api/tour/latest', '/api/tour/:slug'], async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const slug = req.params.slug;
    let destination = null;

    if (slug && slug !== 'latest' && slug !== 'default') {
      destination = await prisma.destination.findUnique({
        where: { slug },
        include: {
          scenes: {
            include: { hotspots: { include: { target_scene: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    } else {
      destination = await prisma.destination.findFirst({
        orderBy: { createdAt: 'desc' },
        include: {
          scenes: {
            include: { hotspots: { include: { target_scene: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    }

    if (!destination) {
      return res.status(404).json({
        success: false,
        message: slug ? `Destinasi "${slug}" tidak ditemukan.` : 'Belum ada data destinasi.',
      });
    }

    if (destination.scenes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Destinasi ini belum memiliki scene panorama 360.',
        destination,
      });
    }

    const startingScene = destination.scenes.find((s) => s.is_starting_scene) || destination.scenes[0];

    const scenesConfig = {};
    destination.scenes.forEach((scene) => {
      scenesConfig[scene.id] = {
        id: scene.id,
        title: scene.title,
        type: 'equirectangular',
        panorama: scene.image_url,
        pitch: scene.pitch,
        yaw: scene.yaw,
        hfov: scene.hfov || 100,
        hotSpots: scene.hotspots.map((h) => {
          const isNav = h.type === 'nav';
          return {
            id: h.id,
            pitch: h.pitch,
            yaw: h.yaw,
            type: isNav ? 'scene' : 'info',
            text: h.tooltip_text,
            sceneId: isNav ? h.target_scene_id : undefined,
            targetTitle: isNav && h.target_scene ? h.target_scene.title : undefined,
            cssClass: isNav ? 'custom-hotspot-nav' : 'custom-hotspot-info',
          };
        }),
      };
    });

    return res.json({
      success: true,
      destination: {
        id: destination.id,
        slug: destination.slug,
        title: destination.title,
        description: destination.description,
        thumbnail_url: destination.thumbnail_url,
      },
      scenesList: destination.scenes.map((s) => ({
        id: s.id,
        title: s.title,
        image_url: s.image_url,
        is_starting_scene: s.is_starting_scene,
      })),
      default: {
        firstScene: startingScene.id,
        author: 'Tur Virtual 360°',
        sceneFadeDuration: 1000,
        autoLoad: true,
        autoRotate: -2,
        compass: false,
        showControls: false,
      },
      scenes: scenesConfig,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat konfigurasi tur: ' + error.message,
    });
  }
});

// ============================================================================
// 14. API: CRUD DESTINASI
// ============================================================================
app.get('/api/destinations', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const destinations = await prisma.destination.findMany({
      include: {
        _count: { select: { scenes: true } },
        scenes: { include: { hotspots: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, data: destinations });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/destinations', authenticateAdmin, async (req, res) => {
  try {
    const { title, slug, description, thumbnail_url } = req.body;
    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Judul dan deskripsi destinasi wajib diisi.' });
    }

    const cleanSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
    const existing = await prisma.destination.findUnique({ where: { slug: cleanSlug } });
    if (existing) {
      return res.status(400).json({ success: false, message: `Slug "${cleanSlug}" sudah dipakai.` });
    }

    const newDest = await prisma.destination.create({
      data: {
        title,
        slug: cleanSlug,
        description,
        thumbnail_url: thumbnail_url || '/uploads/alun_alun_taman.jpg',
      },
    });

    return res.status(201).json({ success: true, message: 'Destinasi berhasil dibuat.', data: newDest });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/destinations/:id', authenticateAdmin, async (req, res) => {
  try {
    const { title, slug, description, thumbnail_url } = req.body;
    const updated = await prisma.destination.update({
      where: { id: req.params.id },
      data: { title, slug, description, thumbnail_url },
    });
    return res.json({ success: true, message: 'Destinasi berhasil diperbarui.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/destinations/:id', authenticateAdmin, async (req, res) => {
  try {
    await prisma.destination.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Destinasi dan semua scene di dalamnya berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 15. API: CRUD SCENE (PANORAMA 360)
// ============================================================================
app.get('/api/scenes/:id', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const scene = await prisma.scene.findUnique({
      where: { id: req.params.id },
      include: {
        destination: true,
        hotspots: { include: { target_scene: true } },
      },
    });
    if (!scene) return res.status(404).json({ success: false, message: 'Scene tidak ditemukan.' });
    return res.json({ success: true, data: scene });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/scenes', authenticateAdmin, async (req, res) => {
  try {
    const { destination_id, title, image_url, pitch, yaw, hfov, is_starting_scene } = req.body;
    if (!destination_id || !title || !image_url) {
      return res.status(400).json({ success: false, message: 'Destinasi, judul scene, dan tautan gambar wajib diisi.' });
    }

    if (is_starting_scene) {
      await prisma.scene.updateMany({
        where: { destination_id },
        data: { is_starting_scene: false },
      });
    }

    const newScene = await prisma.scene.create({
      data: {
        destination_id,
        title,
        image_url,
        pitch: parseFloat(pitch) || 0.0,
        yaw: parseFloat(yaw) || 0.0,
        hfov: parseFloat(hfov) || 100.0,
        is_starting_scene: Boolean(is_starting_scene),
      },
    });

    return res.status(201).json({ success: true, message: 'Scene panorama berhasil disimpan.', data: newScene });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/scenes/:id', authenticateAdmin, async (req, res) => {
  try {
    const { destination_id, title, image_url, pitch, yaw, hfov, is_starting_scene } = req.body;
    const current = await prisma.scene.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ success: false, message: 'Scene tidak ditemukan.' });

    const targetDestId = destination_id || current.destination_id;
    if (is_starting_scene) {
      await prisma.scene.updateMany({
        where: { destination_id: targetDestId },
        data: { is_starting_scene: false },
      });
    }

    const updated = await prisma.scene.update({
      where: { id: req.params.id },
      data: {
        destination_id: targetDestId,
        title: title !== undefined ? title : current.title,
        image_url: image_url !== undefined ? image_url : current.image_url,
        pitch: pitch !== undefined ? (parseFloat(pitch) || 0.0) : current.pitch,
        yaw: yaw !== undefined ? (parseFloat(yaw) || 0.0) : current.yaw,
        hfov: hfov !== undefined ? (parseFloat(hfov) || 100.0) : current.hfov,
        is_starting_scene: is_starting_scene !== undefined ? Boolean(is_starting_scene) : current.is_starting_scene,
      },
    });

    return res.json({ success: true, message: 'Data scene berhasil diperbarui.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/scenes/:id', authenticateAdmin, async (req, res) => {
  try {
    await prisma.scene.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Scene berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 16. API: CRUD HOTSPOT (TITIK NAVIGASI)
// ============================================================================
app.post('/api/hotspots', authenticateAdmin, async (req, res) => {
  try {
    const { scene_id, target_scene_id, pitch, yaw, type, tooltip_text } = req.body;
    if (!scene_id || pitch === undefined || yaw === undefined || !tooltip_text) {
      return res.status(400).json({ success: false, message: 'Scene asal, koordinat Pitch & Yaw, serta tooltip wajib diisi.' });
    }

    if (type === 'nav' && !target_scene_id) {
      return res.status(400).json({ success: false, message: 'Hotspot jenis navigasi wajib memilih scene tujuan.' });
    }

    const newHotspot = await prisma.hotspot.create({
      data: {
        scene_id,
        target_scene_id: type === 'nav' ? target_scene_id : null,
        pitch: parseFloat(pitch),
        yaw: parseFloat(yaw),
        type: type || 'nav',
        tooltip_text,
      },
      include: { target_scene: true },
    });

    return res.status(201).json({ success: true, message: 'Hotspot berhasil ditambahkan.', data: newHotspot });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.put('/api/hotspots/:id', authenticateAdmin, async (req, res) => {
  try {
    const { target_scene_id, pitch, yaw, type, tooltip_text } = req.body;
    const updated = await prisma.hotspot.update({
      where: { id: req.params.id },
      data: {
        target_scene_id: type === 'nav' ? target_scene_id : null,
        pitch: pitch !== undefined ? parseFloat(pitch) : undefined,
        yaw: yaw !== undefined ? parseFloat(yaw) : undefined,
        type,
        tooltip_text,
      },
      include: { target_scene: true },
    });

    return res.json({ success: true, message: 'Titik hotspot berhasil diperbarui.', data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.delete('/api/hotspots/:id', authenticateAdmin, async (req, res) => {
  try {
    await prisma.hotspot.delete({ where: { id: req.params.id } });
    return res.json({ success: true, message: 'Hotspot berhasil dihapus.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 17. API: PENJELAJAH BASIS DATA & STATISTIK (SQLITE EXPLORER)
// ============================================================================
app.get('/api/system/db-info', async (req, res) => {
  try {
    const dbPath = path.join(__dirname, 'prisma', 'dev.db');
    let dbSize = '0 KB';
    let fileExists = false;

    if (fs.existsSync(dbPath)) {
      fileExists = true;
      const stats = fs.statSync(dbPath);
      dbSize = (stats.size / 1024).toFixed(2) + ' KB';
      if (stats.size > 1024 * 1024) {
        dbSize = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
      }
    }

    const [adminCount, destCount, sceneCount, hotspotCount] = await Promise.all([
      prisma.adminUser.count(),
      prisma.destination.count(),
      prisma.scene.count(),
      prisma.hotspot.count(),
    ]);

    return res.json({
      success: true,
      config: {
        provider: 'SQLite (Prisma ORM)',
        url: 'file:./dev.db',
        configFile: 'prisma/schema.prisma',
        filePath: 'prisma/dev.db',
        fileExists,
        fileSize: dbSize,
        status: 'Terhubung & Aktif',
      },
      stats: {
        adminUsers: adminCount,
        destinations: destCount,
        scenes: sceneCount,
        hotspots: hotspotCount,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/system/tables/:tableName', async (req, res) => {
  try {
    const { tableName } = req.params;
    let rows = [];
    if (tableName === 'Destination') {
      rows = await prisma.destination.findMany({ orderBy: { createdAt: 'desc' } });
    } else if (tableName === 'Scene') {
      rows = await prisma.scene.findMany({
        include: { destination: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      });
    } else if (tableName === 'Hotspot') {
      rows = await prisma.hotspot.findMany({
        include: {
          scene: { select: { title: true } },
          target_scene: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    } else if (tableName === 'AdminUser') {
      rows = await prisma.adminUser.findMany({
        select: { id: true, username: true, createdAt: true, updatedAt: true },
      });
    } else {
      return res.status(404).json({ success: false, message: 'Tabel tidak ditemukan' });
    }
    return res.json({ success: true, table: tableName, count: rows.length, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 18. API AKADEMIK: ANALISIS TEORI GRAF BERARAH (DIGRAPH G = (V,E)) UNTUK SKRIPSI
// ============================================================================
app.get('/api/system/graph-analysis/:destinationId', async (req, res) => {
  try {
    const { destinationId } = req.params;

    const destination = await prisma.destination.findUnique({
      where: { id: destinationId },
      include: {
        scenes: {
          include: {
            hotspots: { where: { type: 'nav' } },
          },
        },
      },
    });

    if (!destination) {
      return res.status(404).json({ success: false, message: 'Destinasi tidak ditemukan.' });
    }

    const scenes = destination.scenes;
    const vertexCount = scenes.length;
    const sceneIdToIndex = new Map();
    scenes.forEach((s, idx) => sceneIdToIndex.set(s.id, idx));

    // 1. Matriks Adjasensi Biner A[i][j] & Derajat Simpul
    const adjMatrix = Array.from({ length: vertexCount }, () => Array(vertexCount).fill(0));
    let edgeCount = 0;
    const inDegree = Array(vertexCount).fill(0);
    const outDegree = Array(vertexCount).fill(0);
    const edges = [];

    scenes.forEach((s) => {
      const u = sceneIdToIndex.get(s.id);
      s.hotspots.forEach((h) => {
        if (h.target_scene_id && sceneIdToIndex.has(h.target_scene_id)) {
          const v = sceneIdToIndex.get(h.target_scene_id);
          adjMatrix[u][v] = 1;
          edgeCount++;
          outDegree[u]++;
          inDegree[v]++;
          edges.push({
            sourceId: s.id,
            sourceTitle: s.title,
            targetId: h.target_scene_id,
            pitch: h.pitch,
            yaw: h.yaw,
          });
        }
      });
    });

    // 2. Evaluasi Status Simpul (Normal, Dead End, atau Terisolasi)
    const verticesAnalysis = scenes.map((s, idx) => {
      const isDeadEnd = outDegree[idx] === 0;
      const isUnreachable = inDegree[idx] === 0 && !s.is_starting_scene;
      return {
        id: s.id,
        index: idx,
        title: s.title,
        isStarting: s.is_starting_scene,
        inDegree: inDegree[idx],
        outDegree: outDegree[idx],
        status: isUnreachable
          ? 'Terisolasi (Tidak ada hotspot masuk)'
          : isDeadEnd
          ? 'Buntu (Dead End / Tanpa navigasi keluar)'
          : 'Normal Terhubung',
      };
    });

    // 3. Kerapatan Graf (Graph Density) D = |E| / (|V| * (|V| - 1))
    const maxEdges = vertexCount > 1 ? vertexCount * (vertexCount - 1) : 1;
    const density = vertexCount > 1 ? (edgeCount / maxEdges).toFixed(3) : '1.000';

    // 4. Pengujian Keterjangkauan Simpul Menggunakan Breadth-First Search (BFS)
    const startingSceneIdx = scenes.findIndex((s) => s.is_starting_scene);
    const rootIdx = startingSceneIdx >= 0 ? startingSceneIdx : 0;
    const visited = Array(vertexCount).fill(false);
    const queue = [rootIdx];
    if (rootIdx < vertexCount) visited[rootIdx] = true;

    while (queue.length > 0) {
      const curr = queue.shift();
      for (let neighbor = 0; neighbor < vertexCount; neighbor++) {
        if (adjMatrix[curr][neighbor] === 1 && !visited[neighbor]) {
          visited[neighbor] = true;
          queue.push(neighbor);
        }
      }
    }

    const unreachedCount = visited.filter((v) => !v).length;
    const isFullyTraversable = unreachedCount === 0;

    return res.json({
      success: true,
      destination: { id: destination.id, title: destination.title },
      metrics: {
        vertices: vertexCount, // |V|
        edges: edgeCount,       // |E|
        density: parseFloat(density),
        isFullyTraversable,
        startingScene: scenes[rootIdx]?.title || 'Tidak diset',
        isolatedNodesCount: unreachedCount,
      },
      vertices: verticesAnalysis,
      adjacencyMatrix: {
        labels: scenes.map((s) => s.title),
        matrix: adjMatrix,
      },
      edges,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Pemicu Seeding Data Bawaan
app.post('/api/system/seed', authenticateAdmin, async (req, res) => {
  try {
    const result = await autoSeedDatabase(true);
    return res.json({
      success: true,
      message: 'Basis data berhasil diisi data destinasi, 3 panorama, dan hotspot navigasi!',
      result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================================================
// 19. INISIALISASI SKEMA DATABASE & AUTO-SEED
// ============================================================================
async function ensureDatabaseSchema() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AdminUser" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "username" TEXT NOT NULL,
        "password_hash" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "AdminUser_username_key" ON "AdminUser"("username");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Destination" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "slug" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL,
        "thumbnail_url" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Destination_slug_key" ON "Destination"("slug");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Scene" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "destination_id" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "image_url" TEXT NOT NULL,
        "pitch" REAL NOT NULL DEFAULT 0.0,
        "yaw" REAL NOT NULL DEFAULT 0.0,
        "hfov" REAL NOT NULL DEFAULT 100.0,
        "is_starting_scene" BOOLEAN NOT NULL DEFAULT 0,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("destination_id") REFERENCES "Destination" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Hotspot" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "scene_id" TEXT NOT NULL,
        "target_scene_id" TEXT,
        "pitch" REAL NOT NULL,
        "yaw" REAL NOT NULL,
        "type" TEXT NOT NULL,
        "tooltip_text" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY ("scene_id") REFERENCES "Scene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        FOREIGN KEY ("target_scene_id") REFERENCES "Scene" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SystemSetting" (
        "key" TEXT NOT NULL PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Skema tabel basis data SQLite terverifikasi aktif.');
  } catch (err) {
    console.log('Info skema database SQLite:', err.message);
  }
}

async function autoSeedDatabase(force = false) {
  try {
    await ensureDatabaseSchema();

    const adminCount = await prisma.adminUser.count();
    const destCount = await prisma.destination.count();

    let adminCreated = false;
    if (adminCount === 0 || force) {
      const existingAdmin = await prisma.adminUser.findUnique({ where: { username: 'admin' } });
      if (!existingAdmin) {
        const passwordHash = await bcrypt.hash('admin123', 10);
        await prisma.adminUser.create({
          data: { username: 'admin', password_hash: passwordHash },
        });
        adminCreated = true;
        console.log('✅ Auto-seed: Akun Admin default dibuat (user: admin, pass: admin123)');
      }
    }

    let destCreated = false;
    if (destCount === 0 || force) {
      let destination = await prisma.destination.findUnique({
        where: { slug: 'alun-alun-dan-masjid-raya-bandung' },
      });

      if (!destination) {
        destination = await prisma.destination.create({
          data: {
            slug: 'alun-alun-dan-masjid-raya-bandung',
            title: 'Alun-Alun dan Masjid Raya Bandung',
            description: 'Jelajahi keindahan Alun-Alun Kota Bandung dan Masjid Raya Jawa Barat dalam tur virtual 360 derajat interaktif beresolusi tinggi.',
            thumbnail_url: '/uploads/alun_alun_taman.jpg',
          },
        });
        destCreated = true;
      }

      const existingScenes = await prisma.scene.findMany({
        where: { destination_id: destination.id },
      });

      if (existingScenes.length === 0) {
        const scene1 = await prisma.scene.create({
          data: {
            destination_id: destination.id,
            title: 'Taman Rumput Sintetis Alun-Alun',
            image_url: '/uploads/alun_alun_taman.jpg',
            pitch: -2.0,
            yaw: 15.0,
            hfov: 105.0,
            is_starting_scene: true,
          },
        });

        const scene2 = await prisma.scene.create({
          data: {
            destination_id: destination.id,
            title: 'Pelataran & Menara Kembar Masjid',
            image_url: '/uploads/masjid_halaman.jpg',
            pitch: 5.0,
            yaw: -30.0,
            hfov: 100.0,
            is_starting_scene: false,
          },
        });

        const scene3 = await prisma.scene.create({
          data: {
            destination_id: destination.id,
            title: 'Ruang Dalam Masjid Raya',
            image_url: '/uploads/masjid_dalam.jpg',
            pitch: 0.0,
            yaw: 90.0,
            hfov: 100.0,
            is_starting_scene: false,
          },
        });

        await prisma.hotspot.createMany({
          data: [
            {
              scene_id: scene1.id,
              target_scene_id: scene2.id,
              pitch: -4.5,
              yaw: 28.5,
              type: 'nav',
              tooltip_text: 'Masuk ke Pelataran Masjid Raya Bandung',
            },
            {
              scene_id: scene1.id,
              target_scene_id: null,
              pitch: 12.0,
              yaw: -70.0,
              type: 'info',
              tooltip_text: 'Taman Alun-alun Bandung dengan hamparan rumput sintetis seluas 4.000 m², tempat rekreasi favorit warga.',
            },
            {
              scene_id: scene2.id,
              target_scene_id: scene1.id,
              pitch: -5.0,
              yaw: -155.0,
              type: 'nav',
              tooltip_text: 'Kembali ke Taman Alun-Alun',
            },
            {
              scene_id: scene2.id,
              target_scene_id: scene3.id,
              pitch: 2.0,
              yaw: 35.0,
              type: 'nav',
              tooltip_text: 'Masuk ke Ruang Utama Sholat',
            },
            {
              scene_id: scene2.id,
              target_scene_id: null,
              pitch: 35.0,
              yaw: -20.0,
              type: 'info',
              tooltip_text: 'Dua Menara Kembar setinggi 81 meter yang menjadi ikon Bandung.',
            },
            {
              scene_id: scene3.id,
              target_scene_id: scene2.id,
              pitch: -3.0,
              yaw: -170.0,
              type: 'nav',
              tooltip_text: 'Keluar ke Pelataran Masjid',
            },
            {
              scene_id: scene3.id,
              target_scene_id: null,
              pitch: 20.0,
              yaw: 45.0,
              type: 'info',
              tooltip_text: 'Kubah utama berdiameter 30 meter dengan hiasan ornamen kaligrafi Arab yang megah.',
            },
          ],
        });
        console.log('✅ Auto-seed: 3 Scene & 7 Hotspot berhasil dibuat secara otomatis!');
      }
    }

    return { adminCreated, destCreated };
  } catch (err) {
    console.error('Peringatan auto-seed:', err.message);
    return { error: err.message };
  }
}

// ============================================================================
// 20. PENANGANAN ERROR GLOBAL & GRACEFUL SHUTDOWN
// ============================================================================
app.use((err, req, res, next) => {
  console.error('[SERVER AUDIT ERROR]:', err);
  const status = err.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: IS_PROD && status === 500 ? 'Terjadi kesalahan sistem internal.' : err.message,
  });
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

// Jalankan Server Express (kompatibel dengan cPanel Phusion Passenger & Localhost)
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Server Tur Virtual 360° aktif di port: ${PORT}`);
  console.log(`🌐 Tautan Viewer Publik : http://localhost:${PORT}`);
  console.log(`⚙️ Tautan Panel Admin   : http://localhost:${PORT}/admin`);
  console.log(`=======================================================`);
  await autoSeedDatabase(false);
});