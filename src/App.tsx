/**
 * Aplikasi Wrapper Tur Virtual 360° Interaktif
 * Menyediakan navigasi instan antara Mode Pengunjung (Viewer 360°) dan Panel Admin
 */

import { useState, useEffect } from 'react';
import { Compass, Settings, Eye, ExternalLink } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'tour' | 'admin'>('tour');
  const [currentSlug] = useState('alun-alun-dan-masjid-raya-bandung');

  useEffect(() => {
    // Cek path awal jika mengandung /admin
    if (window.location.pathname.startsWith('/admin')) {
      setCurrentTab('admin');
    }
  }, []);

  const tourUrl = `/tour/${currentSlug}`;
  const adminUrl = `/admin`;

  return (
    <div className="flex flex-col w-screen h-screen bg-slate-950 text-white overflow-hidden">
      {/* Bilah Atas Navigasi Cepat Antara Mode Viewer & Panel Admin */}
      <header className="h-12 bg-slate-900 border-b border-white/10 px-4 flex items-center justify-between z-50 flex-shrink-0 select-none">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-sky-500/20 text-sky-400 rounded-lg border border-sky-500/30">
            <Compass className="w-4 h-4" />
          </div>
          <span className="font-bold text-xs sm:text-sm tracking-wide text-slate-100">
            Tur Virtual 360° Interaktif
          </span>
          <span className="hidden md:inline text-[11px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-full font-medium">
            Alun-Alun & Masjid Raya Bandung
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Tab Switcher */}
          <div className="bg-slate-950 p-1 rounded-xl border border-white/10 flex items-center gap-1">
            <button
              onClick={() => setCurrentTab('tour')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'tour'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Mode Pengunjung (360°)</span>
            </button>

            <button
              onClick={() => setCurrentTab('admin')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                currentTab === 'admin'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Panel Admin</span>
            </button>
          </div>

          <a
            href={currentTab === 'tour' ? tourUrl : adminUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Buka Tab Mandiri"
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </header>

      {/* Konten Iframe Viewer / Admin */}
      <main className="flex-1 w-full h-[calc(100vh-48px)] relative bg-black">
        <iframe
          key={currentTab}
          src={currentTab === 'tour' ? tourUrl : adminUrl}
          title={currentTab === 'tour' ? 'Viewer Tur 360°' : 'Panel Admin Tur 360°'}
          className="w-full h-full border-0 absolute inset-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
          loading="eager"
        />
      </main>
    </div>
  );
}
