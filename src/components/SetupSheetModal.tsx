import React, { useEffect } from 'react';
import { X, Printer, Download, ShieldCheck, QrCode, Wrench, Layers } from 'lucide-react';
import { resolveImgUrl } from '../utils';

export interface SetupSheetData {
  title: string;
  drawingNo?: string;
  material?: string;
  quantity?: number;
  zeroPoints: { id: string; desc: string; val: string }[];
  clamping: {
    system: string;
    colletOrJaw: string;
    pressureBar: string;
    forceKn: string;
    maxRpm: string;
    image?: string;
  };
  tools: {
    slot: string;
    type: string;
    insert: string;
    vc: string;
    n: string;
    vf: string;
  }[];
  bom: {
    pos: number;
    matNr: string;
    name: string;
    qty: number;
    category: string;
    image?: string;
  }[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  data: SetupSheetData;
}

export default function SetupSheetModal({ isOpen, onClose, data }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const csvCell = (v: string | number) => {
    const s = String(v ?? '');
    // Quote + escape inner quotes; prefix risky leading chars (formula injection).
    const q = s.replace(/"/g, '""');
    return (/^[=+\-@]/.test(s) ? `"'"${q}"` : `"${q}"`);
  };
  const handleExportCsv = () => {
    const headers = ['Position', 'Materialnummer', 'Bezeichnung', 'Kategorie', 'Menge'];
    const rows = data.bom.map(b => [b.pos, csvCell(b.matNr), csvCell(b.name), csvCell(b.category), b.qty].join(';'));
    const blob = new Blob([`\uFEFF${headers.join(';')}\n${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `HAINBUCH_BOM_${(data.drawingNo || 'Plan').replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Werkstatt-Einrichteblatt"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto print:p-0 print:bg-white print:static">
      {/* Modal Card */}
      <div className="bg-white text-neutral-900 w-full max-w-4xl rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col my-auto max-h-[92dvh] print:max-h-none print:shadow-none print:border-none print:rounded-none">
        
        {/* Action Header (Hidden in Print) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-3.5 bg-neutral-50 border-b border-neutral-200 text-neutral-900 print:hidden shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center font-bold text-white tracking-wider text-xs shadow-sm shrink-0">
              HB
            </div>
            <div className="truncate">
              <h2 className="text-sm sm:text-base font-bold tracking-tight text-neutral-950 truncate">Werkstatt-Einrichteblatt</h2>
              <p className="text-[11px] sm:text-xs text-neutral-500 hidden sm:block">DIN A4 Fertigungsdokument für Einrichter & Maschinenbediener</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-white hover:bg-neutral-100 text-xs font-semibold text-neutral-700 rounded-xl transition-colors border border-neutral-300 shadow-sm h-9"
              title="Stückliste als CSV herunterladen"
            >
              <Download size={14} className="text-red-600 shrink-0" />
              <span className="hidden sm:inline">BOM CSV Export</span>
              <span className="sm:hidden">CSV</span>
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-xs font-semibold text-white rounded-xl transition-colors shadow-sm h-9"
              title="Als DIN A4 drucken oder PDF speichern"
            >
              <Printer size={14} className="shrink-0" />
              <span className="hidden sm:inline">Drucken / PDF</span>
              <span className="sm:hidden">Drucken</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Schließen"
              className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-200 transition-colors ml-1"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Printable Sheet Body */}
        <div className="print-keep-color p-4 sm:p-8 overflow-y-auto print:p-0 space-y-4 sm:space-y-6 text-xs leading-relaxed scroll-thin">
          
          {/* Header Grid */}
          <div className="border-b-2 border-neutral-900 pb-4 flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-red-600 text-white font-black text-sm px-2 py-0.5 rounded tracking-wider">HAINBUCH</span>
                <span className="text-neutral-500 font-semibold text-xs tracking-widest uppercase">SPANNTECHNIK</span>
              </div>
              <h1 className="text-xl font-black text-neutral-950 uppercase tracking-tight">{data.title}</h1>
              <p className="text-neutral-600 text-xs mt-0.5">
                Zeichnungs-Nr: <strong className="text-neutral-900">{data.drawingNo || 'HT-PROD-001'}</strong> | Werkstoff: <strong className="text-neutral-900">{data.material || '1.4301 / C45'}</strong> | Losgröße: <strong className="text-neutral-900">{data.quantity || 100} Stk.</strong>
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase text-neutral-400">Datum: {new Date().toLocaleDateString('de-DE')}</div>
              <div className="text-[10px] font-mono text-emerald-700 font-bold flex items-center gap-1 justify-end mt-0.5">
                <ShieldCheck size={13} /> ISO 286 GEPRÜFT
              </div>
            </div>
          </div>

          {/* Machine & Clamping Parameters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-neutral-300 rounded-lg p-3.5 bg-neutral-50/50">
              <h3 className="font-bold uppercase text-[11px] text-neutral-800 flex items-center gap-1.5 mb-2.5 pb-1 border-b border-neutral-200">
                <Layers size={13} className="text-red-600" />
                Spannmittel & Sicherheitsgrenzen
              </h3>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-neutral-500 block text-[10px]">Hauptspannmittel:</span>
                  <strong className="text-neutral-900">{data.clamping.system}</strong>
                </div>
                <div>
                  <span className="text-neutral-500 block text-[10px]">Spannelement:</span>
                  <strong className="text-neutral-900">{data.clamping.colletOrJaw}</strong>
                </div>
                <div>
                  <span className="text-neutral-500 block text-[10px]">Zylinderdruck:</span>
                  <strong className="text-neutral-900">{data.clamping.pressureBar || '18 bar'}</strong>
                </div>
                <div>
                  <span className="text-neutral-500 block text-[10px]">Max. Spindeldrehzahl:</span>
                  <strong className="text-neutral-900">{data.clamping.maxRpm || '3.500 1/min'}</strong>
                </div>
              </div>
            </div>

            <div className="border border-neutral-300 rounded-lg p-3.5 bg-neutral-50/50">
              <h3 className="font-bold uppercase text-[11px] text-neutral-800 flex items-center gap-1.5 mb-2.5 pb-1 border-b border-neutral-200">
                <Wrench size={13} className="text-red-600" />
                Maschinennullpunkte (WKS)
              </h3>
              <div className="space-y-1.5 text-[11px]">
                {data.zeroPoints.map((zp, i) => (
                  <div key={i} className="flex justify-between items-center py-0.5 border-b border-neutral-200/60 last:border-none">
                    <span className="font-bold text-red-700 w-12">{zp.id}</span>
                    <span className="text-neutral-600 flex-1">{zp.desc}</span>
                    <span className="font-mono font-bold text-neutral-900">{zp.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Tooling Table */}
          <div>
            <h3 className="font-bold uppercase text-[11px] text-neutral-900 mb-2 flex items-center gap-1.5">
              Werkzeugbelegung & Schnittwerte
            </h3>
            <div className="overflow-x-auto rounded-xl border border-neutral-300 scroll-thin shadow-sm">
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead className="bg-neutral-900 text-white font-semibold text-[10px] uppercase">
                  <tr>
                    <th className="py-2 px-3">Platz</th>
                    <th className="py-2 px-3">Werkzeugtyp</th>
                    <th className="py-2 px-3">WSP / Schneidstoff</th>
                    <th className="py-2 px-3 text-right">vc [m/min]</th>
                    <th className="py-2 px-3 text-right">n [1/min]</th>
                    <th className="py-2 px-3 text-right">vf [mm/min]</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {data.tools.map((t, i) => (
                    <tr key={i} className={i % 2 === 1 ? 'bg-neutral-50' : 'bg-white'}>
                      <td className="py-2 px-3 font-bold text-neutral-900">{t.slot}</td>
                      <td className="py-2 px-3 text-neutral-800">{t.type}</td>
                      <td className="py-2 px-3 font-mono text-neutral-700">{t.insert}</td>
                      <td className="py-2 px-3 text-right font-mono">{t.vc}</td>
                      <td className="py-2 px-3 text-right font-mono">{t.n}</td>
                      <td className="py-2 px-3 text-right font-mono">{t.vf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* HAINBUCH Bill of Materials (BOM) */}
          <div>
            <h3 className="font-bold uppercase text-[11px] text-neutral-900 mb-2 flex items-center gap-1.5">
              HAINBUCH Stückliste & Artikelnummern (BOM)
            </h3>
            <div className="overflow-x-auto rounded-xl border border-neutral-300 scroll-thin shadow-sm">
              <table className="w-full min-w-[520px] text-left text-[11px]">
                <thead className="bg-neutral-100 text-neutral-700 font-semibold text-[10px] uppercase border-b border-neutral-300">
                  <tr>
                    <th className="py-2 px-3 w-10">Pos</th>
                    <th className="py-2 px-3 w-28">Artikel-Nr.</th>
                    <th className="py-2 px-3">Bezeichnung</th>
                    <th className="py-2 px-3">Kategorie</th>
                    <th className="py-2 px-3 text-right w-12">Menge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {data.bom.map((b, i) => (
                    <tr key={i} className={i % 2 === 1 ? 'bg-neutral-50/50' : 'bg-white'}>
                      <td className="py-2 px-3 text-neutral-500 font-mono">{b.pos}</td>
                      <td className="py-2 px-3 font-mono font-bold text-red-700">{b.matNr || 'Auf Anfrage'}</td>
                      <td className="py-2 px-3 text-neutral-900 font-medium">{b.name}</td>
                      <td className="py-2 px-3 text-neutral-600">{b.category}</td>
                      <td className="py-2 px-3 text-right font-bold">{b.qty}x</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Signoff Footer */}
          <div className="border-t-2 border-neutral-300 pt-4 grid grid-cols-3 gap-6 text-[10px] text-neutral-500">
            <div>
              <span className="block mb-4">Erstellt durch / AV:</span>
              <div className="border-b border-neutral-400 w-full"></div>
            </div>
            <div>
              <span className="block mb-4">Geprüft / Einrichter:</span>
              <div className="border-b border-neutral-400 w-full"></div>
            </div>
            <div className="text-right">
              <div className="inline-flex items-center gap-1 font-mono text-[9px] text-neutral-400 border border-neutral-200 rounded px-2 py-1 bg-neutral-50">
                <QrCode size={12} className="text-neutral-700" />
                VERIFIED HAINBUCH ADVISOR PLAN
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
