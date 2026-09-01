import React, { useState } from 'react';
import { Cpu, ChevronDown, Check } from 'lucide-react';

export interface MachineProfile {
  id: string;
  name: string;
  type: 'lathe' | 'mill' | 'millturn';
  spindle: string;
  drawtube?: string;
  table?: string;
}

export const PRESET_MACHINES: MachineProfile[] = [
  {
    id: 'dmg-nlx2500',
    name: 'DMG Mori NLX 2500',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 80 mm / Gewinde M70x2',
  },
  {
    id: 'mazak-qt200',
    name: 'Mazak QuickTurn 200',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 65 mm / Gewinde M60x2',
  },
  {
    id: 'haas-st20',
    name: 'Haas ST-20',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 52 mm / Gewinde M55x2',
  },
  {
    id: 'dmg-clx450',
    name: 'DMG Mori CLX 450',
    type: 'lathe',
    spindle: 'Kurzkegel A2-8 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 80 mm / Gewinde M85x2',
  },
  {
    id: 'hermle-c400',
    name: 'Hermle C400 (5-Achs)',
    type: 'mill',
    spindle: '5-Achs Schwenkrundtisch Ø 440 mm',
    table: 'T-Nuten 14 mm H7 / 4 Spannkanäle',
  },
  {
    id: 'universal',
    name: 'Universal-Maschine (Manuell)',
    type: 'millturn',
    spindle: 'Direkte Flansch- & Zylinderanbindung',
  },
];

interface Props {
  selected: MachineProfile;
  onSelect: (m: MachineProfile) => void;
}

export default function MachineSelector({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-xs font-medium text-neutral-300 hover:text-white transition-all shadow-sm group"
        title="Aktive CNC-Maschine für Flansch- und Zugrohrberechnung wählen"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
        <Cpu size={13} className="text-red-500 group-hover:rotate-12 transition-transform" />
        <span className="truncate max-w-[130px] sm:max-w-[180px] font-semibold">{selected.name}</span>
        <ChevronDown size={12} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1.5 w-72 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-50 overflow-hidden py-1 divide-y divide-neutral-800/60 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-2 bg-neutral-950/60">
              <span className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase">Aktiver Maschinenpark</span>
              <p className="text-[10px] text-neutral-500 mt-0.5">Spindel- & Zugrohradapter werden automatisch ermittelt</p>
            </div>
            <div className="max-h-60 overflow-y-auto py-1">
              {PRESET_MACHINES.map((m) => {
                const isSel = m.id === selected.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      onSelect(m);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-neutral-800/70 transition-colors ${
                      isSel ? 'bg-red-950/30 text-white font-semibold' : 'text-neutral-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span>{m.name}</span>
                        {isSel && <span className="text-[9px] px-1 bg-red-600/30 text-red-400 rounded font-mono">AKTIV</span>}
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{m.spindle}</div>
                    </div>
                    {isSel && <Check size={14} className="text-red-500 shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
