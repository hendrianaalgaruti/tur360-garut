// prisma/seed.js - Seeding data awal Tur Virtual 360° Interaktif
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Memulai proses seeding data awal...');

  // 1. Buat Pengguna Admin default
  const existingAdmin = await prisma.adminUser.findUnique({
    where: { username: 'admin' },
  });

  let adminUser;
  const passwordHash = await bcrypt.hash('admin123', 10);
  if (!existingAdmin) {
    adminUser = await prisma.adminUser.create({
      data: {
        username: 'admin',
        password_hash: passwordHash,
      },
    });
    console.log('Admin default berhasil dibuat: username=admin, password=admin123');
  } else {
    adminUser = existingAdmin;
    console.log('Admin default sudah ada.');
  }

  // 2. Buat Destinasi Referensi: Alun-Alun dan Masjid Raya Bandung
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
    console.log('Destinasi berhasil dibuat:', destination.title);
  } else {
    console.log('Destinasi referensi sudah ada.');
  }

  // 3. Buat Scene Panorama 360
  // Cek apakah scene sudah pernah dibuat
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

    console.log('3 Scene panorama 360 berhasil dibuat.');

    // 4. Buat Hotspot Interaktif
    // Hotspot di Scene 1:
    // a. Navigasi menuju Pelataran Masjid (Scene 2)
    await prisma.hotspot.create({
      data: {
        scene_id: scene1.id,
        target_scene_id: scene2.id,
        pitch: -4.5,
        yaw: 28.5,
        type: 'nav',
        tooltip_text: 'Masuk ke Pelataran Masjid Raya Bandung',
      },
    });

    // b. Info Hotspot: Sejarah Rumput Sintetis Alun-alun
    await prisma.hotspot.create({
      data: {
        scene_id: scene1.id,
        target_scene_id: null,
        pitch: 12.0,
        yaw: -70.0,
        type: 'info',
        tooltip_text: 'Taman Alun-alun Bandung dengan hamparan rumput sintetis seluas 4.000 m², tempat rekreasi favorit warga.',
      },
    });

    // Hotspot di Scene 2:
    // a. Navigasi kembali ke Taman Alun-Alun (Scene 1)
    await prisma.hotspot.create({
      data: {
        scene_id: scene2.id,
        target_scene_id: scene1.id,
        pitch: -5.0,
        yaw: -155.0,
        type: 'nav',
        tooltip_text: 'Kembali ke Taman Alun-Alun',
      },
    });

    // b. Navigasi masuk ke dalam Masjid (Scene 3)
    await prisma.hotspot.create({
      data: {
        scene_id: scene2.id,
        target_scene_id: scene3.id,
        pitch: 2.0,
        yaw: 35.0,
        type: 'nav',
        tooltip_text: 'Masuk ke Ruang Utama Sholat',
      },
    });

    // c. Info Hotspot: Menara Kembar
    await prisma.hotspot.create({
      data: {
        scene_id: scene2.id,
        target_scene_id: null,
        pitch: 35.0,
        yaw: -20.0,
        type: 'info',
        tooltip_text: 'Menara kembar Masjid Raya Bandung memiliki ketinggian 81 meter yang dibuka untuk pengunjung saat akhir pekan.',
      },
    });

    // Hotspot di Scene 3:
    // a. Navigasi keluar ke Pelataran (Scene 2)
    await prisma.hotspot.create({
      data: {
        scene_id: scene3.id,
        target_scene_id: scene2.id,
        pitch: -3.0,
        yaw: -170.0,
        type: 'nav',
        tooltip_text: 'Keluar ke Pelataran Masjid',
      },
    });

    // b. Info Hotspot: Ornamen Kaligrafi & Arsitektur
    await prisma.hotspot.create({
      data: {
        scene_id: scene3.id,
        target_scene_id: null,
        pitch: 20.0,
        yaw: 45.0,
        type: 'info',
        tooltip_text: 'Kubah utama berdiameter 30 meter dengan hiasan ornamen kaligrafi Arab yang megah bernuansa islami dan modern.',
      },
    });

    console.log('Semua titik navigasi & informasi hotspot berhasil dikaitkan.');
  } else {
    console.log('Scene data sudah ada, melewati pembuatan scene.');
  }

  console.log('Proses seeding selesai dengan sukses!');
}

main()
  .catch((e) => {
    console.error('Terjadi kesalahan saat seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
