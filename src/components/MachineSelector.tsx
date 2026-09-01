import React, { useState, useEffect } from 'react';
import { Cpu, ChevronDown, Check, Plus, Trash2, Settings, X, Save } from 'lucide-react';

export interface MachineProfile {
  id: string;
  name: string;
  type: 'lathe' | 'mill' | 'millturn';
  spindle: string;
  drawtube?: string;
  table?: string;
  isCustom?: boolean;
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
    name: 'Haas ST-20 / ST-30',
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
    name: 'Universal-Maschine',
    type: 'millturn',
    spindle: 'Direkte Flansch- & Zylinderanbindung',
  },
];

const STORAGE_KEY = 'hainbuch_custom_machines';

interface Props {
  selected: MachineProfile;
  onSelect: (m: MachineProfile) => void;
}

export default function MachineSelector({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [customMachines, setCustomMachines] = useState<MachineProfile[]>([]);

  // Form State
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'lathe' | 'mill' | 'millturn'>('lathe');
  const [formSpindle, setFormSpindle] = useState('Kurzkegel A2-6 (DIN 55026 / ISO 702-1)');
  const [formDrawtube, setFormDrawtube] = useState('');
  const [formTable, setFormTable] = useState('');

  // Load custom machines on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setCustomMachines(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const newMachine: MachineProfile = {
      id: `custom-${Date.now()}`,
      name: formName.trim(),
      type: formType,
      spindle: formSpindle.trim(),
      drawtube: formType !== 'mill' ? formDrawtube.trim() : undefined,
      table: formType === 'mill' ? formTable.trim() : undefined,
      isCustom: true,
    };

    const updated = [...customMachines, newMachine];
    setCustomMachines(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }

    onSelect(newMachine);
    setShowAddForm(false);
    setOpen(false);
    setFormName('');
    setFormDrawtube('');
    setFormTable('');
  };

  const handleDeleteCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customMachines.filter(m => m.id !== id);
    setCustomMachines(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
    if (selected.id === id) {
      onSelect(PRESET_MACHINES[0]);
    }
  };

  const allMachines = [...customMachines, ...PRESET_MACHINES];

  return (
    <div className="relative">
      {/* Header Button Styled like HAINBUCH Brand */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900/90 hover:bg-neutral-900 border border-neutral-700/80 hover:border-red-600/60 text-xs font-semibold text-neutral-200 hover:text-white transition-all shadow-sm group"
        title="Aktive CNC-Maschine für Flansch- und Zugrohrberechnung wählen"
      >
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
        <Cpu size={13} className="text-red-500 group-hover:rotate-12 transition-transform shrink-0" />
        <span className="truncate max-w-[120px] sm:max-w-[170px]">{selected.name}</span>
        <ChevronDown size={12} className={`text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setShowAddForm(false); }} />
          <div className="absolute right-0 mt-1.5 w-80 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-50 overflow-hidden divide-y divide-neutral-800 animate-in fade-in zoom-in-95 duration-100 text-neutral-200">
            
            {/* Header */}
            <div className="px-3.5 py-2.5 bg-neutral-950 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold tracking-wider text-neutral-400 uppercase">Kunden-Maschinenpark</span>
                <p className="text-[10px] text-neutral-500">Spindel & Zugrohr werden automatisch adaptiert</p>
              </div>
              <button
                onClick={() => setShowAddForm(s => !s)}
                className="flex items-center gap-1 px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-bold transition-colors shadow-sm"
              >
                <Plus size={11} />
                Eigene Maschine
              </button>
            </div>

            {/* Custom Add Form Modal inside Dropdown */}
            {showAddForm ? (
              <form onSubmit={handleSaveCustom} className="p-3.5 space-y-2.5 bg-neutral-950/80 text-xs">
                <div className="flex justify-between items-center pb-1 border-b border-neutral-800">
                  <span className="font-bold text-white text-[11px]">Eigene CNC-Maschine eintragen</span>
                  <button type="button" onClick={() => setShowAddForm(false)} className="text-neutral-400 hover:text-white">
                    <X size={13} />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-400 block mb-0.5 font-semibold">Maschinenhersteller & Modell *</label>
                  <input
                    type="text"
                    required
                    placeholder="z. B. Spinner TC600 / Index G200"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-neutral-400 block mb-0.5 font-semibold">Typ</label>
                    <select
                      value={formType}
                      onChange={e => setFormType(e.target.value as any)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:border-red-500"
                    >
                      <option value="lathe">Drehmaschine</option>
                      <option value="mill">Fräsmaschine / BAZ</option>
                      <option value="millturn">Dreh-Fräszentrum</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-400 block mb-0.5 font-semibold">Spindelnase</label>
                    <select
                      value={formSpindle}
                      onChange={e => setFormSpindle(e.target.value)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-1.5 py-1 text-xs text-white focus:outline-none focus:border-red-500"
                    >
                      <option value="Kurzkegel A2-5 (DIN 55026)">Kurzkegel A2-5</option>
                      <option value="Kurzkegel A2-6 (DIN 55026)">Kurzkegel A2-6</option>
                      <option value="Kurzkegel A2-8 (DIN 55026)">Kurzkegel A2-8</option>
                      <option value="Kurzkegel A2-11 (DIN 55026)">Kurzkegel A2-11</option>
                      <option value="Bajonett DIN 55027 Gr. 6">Bajonett Gr. 6</option>
                      <option value="Camlock DIN 55029">Camlock</option>
                      <option value="T-Nutentisch (14/18 mm)">T-Nutentisch</option>
                    </select>
                  </div>
                </div>

                {formType !== 'mill' ? (
                  <div>
                    <label className="text-[10px] text-neutral-400 block mb-0.5 font-semibold">Zugrohr & Zylinder (optional)</label>
                    <input
                      type="text"
                      placeholder="z. B. Ø 65 mm / Gewinde M60x2"
                      value={formDrawtube}
                      onChange={e => setFormDrawtube(e.target.value)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-red-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] text-neutral-400 block mb-0.5 font-semibold">Frästisch-Spezifikation</label>
                    <input
                      type="text"
                      placeholder="z. B. T-Nuten 14 mm H7 / 4 Kanäle"
                      value={formTable}
                      onChange={e => setFormTable(e.target.value)}
                      className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-red-500"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-2.5 py-1 text-[11px] text-neutral-400 hover:text-white"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1 px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[11px] font-bold"
                  >
                    <Save size={11} />
                    Speichern & Aktivieren
                  </button>
                </div>
              </form>
            ) : (
              /* Machine List */
              <div className="max-h-64 overflow-y-auto py-1 divide-y divide-neutral-800/40">
                {allMachines.map((m) => {
                  const isSel = m.id === selected.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => {
                        onSelect(m);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between hover:bg-neutral-800/80 cursor-pointer transition-colors ${
                        isSel ? 'bg-red-950/40 text-white font-semibold' : 'text-neutral-300'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{m.name}</span>
                          {m.isCustom && (
                            <span className="text-[8px] px-1 bg-neutral-800 text-neutral-400 border border-neutral-700 rounded font-mono">EIGENE</span>
                          )}
                          {isSel && (
                            <span className="text-[8px] px-1 bg-red-600/40 text-red-300 rounded font-mono font-bold">AKTIV</span>
                          )}
                        </div>
                        <div className="text-[10px] text-neutral-500 font-mono mt-0.5 truncate">{m.spindle}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isSel && <Check size={14} className="text-red-500 shrink-0" />}
                        {m.isCustom && (
                          <button
                            onClick={(e) => handleDeleteCustom(m.id, e)}
                            className="p-1 text-neutral-500 hover:text-red-400 transition-colors ml-1"
                            title="Maschine entfernen"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </>
      )}
    </div>
  );
}
