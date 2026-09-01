import React, { useState, useEffect } from 'react';
import { Cpu, ChevronDown, Check, Plus, Trash2, X, Save, Disc, Layers } from 'lucide-react';

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
    drawtube: 'Hohlspannzylinder Ø 80 mm / M70x2',
  },
  {
    id: 'mazak-qt200',
    name: 'Mazak QuickTurn 200',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 65 mm / M60x2',
  },
  {
    id: 'haas-st20',
    name: 'Haas ST-20 / ST-30',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 52 mm / M55x2',
  },
  {
    id: 'dmg-clx450',
    name: 'DMG Mori CLX 450',
    type: 'lathe',
    spindle: 'Kurzkegel A2-8 (DIN 55026)',
    drawtube: 'Hohlspannzylinder Ø 80 mm / M85x2',
  },
  {
    id: 'hermle-c400',
    name: 'Hermle C400 (5-Achs)',
    type: 'mill',
    spindle: '5-Achs Rundtisch Ø 440 mm',
    table: 'T-Nuten 14 mm H7 / 4 Kanäle',
  },
  {
    id: 'universal',
    name: 'Universal-Maschine',
    type: 'millturn',
    spindle: 'Direkte Flanschanbindung',
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

  // Extract short spindle tag (e.g. A2-6, A2-8, 5-Achs)
  const getSpindleTag = (s: string) => {
    if (s.includes('A2-6')) return 'A2-6';
    if (s.includes('A2-8')) return 'A2-8';
    if (s.includes('A2-5')) return 'A2-5';
    if (s.includes('A2-11')) return 'A2-11';
    if (s.includes('5-Achs')) return '5-Achs';
    if (s.includes('T-Nut')) return 'Tisch';
    return 'Spindel';
  };

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
      {/* High-End Industrial Machine Pill Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-red-500 shadow-sm hover:shadow transition-all group text-left"
        title="CNC-Maschine & Spindelschnittstelle konfigurieren"
      >
        <div className="w-7 h-7 rounded-lg bg-neutral-100 group-hover:bg-red-50 flex items-center justify-center text-neutral-600 group-hover:text-red-600 transition-colors shrink-0">
          <Disc size={15} className="group-hover:rotate-90 transition-transform duration-300" />
        </div>

        <div className="min-w-0 pr-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 leading-none">Maschine</span>
            <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 bg-neutral-100 text-neutral-600 rounded text-[8px] leading-tight">
              {getSpindleTag(selected.spindle)}
            </span>
          </div>
          <div className="text-xs font-bold text-neutral-900 truncate max-w-[110px] sm:max-w-[150px] leading-tight mt-0.5">
            {selected.name}
          </div>
        </div>

        <ChevronDown size={13} className={`text-neutral-400 group-hover:text-red-600 transition-transform ml-0.5 shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown Menu */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setShowAddForm(false); }} />
          <div className="absolute right-0 mt-2 w-84 bg-white border border-neutral-200/90 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-neutral-100 animate-in fade-in zoom-in-95 duration-150 text-neutral-800">
            
            {/* Header */}
            <div className="px-4 py-3 bg-neutral-50/80 flex items-center justify-between border-b border-neutral-200/70">
              <div>
                <span className="text-[10px] font-bold tracking-wider text-neutral-500 uppercase">Aktiver Maschinenpark</span>
                <p className="text-[10px] text-neutral-400">Automatische Flansch- & Zylinderadaption</p>
              </div>
              <button
                onClick={() => setShowAddForm(s => !s)}
                className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold transition-all shadow-sm active:scale-95"
              >
                <Plus size={11} />
                Eigene Maschine
              </button>
            </div>

            {/* Custom Add Form */}
            {showAddForm ? (
              <form onSubmit={handleSaveCustom} className="p-4 space-y-3 bg-neutral-50/50 text-xs">
                <div className="flex justify-between items-center pb-1 border-b border-neutral-200">
                  <span className="font-bold text-neutral-900 text-xs">Eigene CNC-Maschine anlegen</span>
                  <button type="button" onClick={() => setShowAddForm(false)} className="text-neutral-400 hover:text-neutral-700">
                    <X size={14} />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-600 block mb-1 font-semibold">Maschinenhersteller & Modell *</label>
                  <input
                    type="text"
                    required
                    placeholder="z. B. Spinner TC600 / Index G200"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-semibold">Typ</label>
                    <select
                      value={formType}
                      onChange={e => setFormType(e.target.value as any)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
                    >
                      <option value="lathe">Drehmaschine</option>
                      <option value="mill">Fräsmaschine / BAZ</option>
                      <option value="millturn">Dreh-Fräszentrum</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-semibold">Spindelnase</label>
                    <select
                      value={formSpindle}
                      onChange={e => setFormSpindle(e.target.value)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
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
                    <label className="text-[10px] text-neutral-600 block mb-1 font-semibold">Zugrohr & Zylinder (optional)</label>
                    <input
                      type="text"
                      placeholder="z. B. Ø 65 mm / Gewinde M60x2"
                      value={formDrawtube}
                      onChange={e => setFormDrawtube(e.target.value)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-semibold">Frästisch-Spezifikation</label>
                    <input
                      type="text"
                      placeholder="z. B. T-Nuten 14 mm H7 / 4 Kanäle"
                      value={formTable}
                      onChange={e => setFormTable(e.target.value)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 font-medium"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-sm"
                  >
                    <Save size={12} />
                    Speichern & Aktivieren
                  </button>
                </div>
              </form>
            ) : (
              /* Machine List */
              <div className="max-h-72 overflow-y-auto py-1.5 divide-y divide-neutral-100">
                {allMachines.map((m) => {
                  const isSel = m.id === selected.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => {
                        onSelect(m);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs flex items-center justify-between hover:bg-neutral-50 cursor-pointer transition-colors ${
                        isSel ? 'bg-red-50/60 text-red-950 font-semibold' : 'text-neutral-700'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-bold text-neutral-900">{m.name}</span>
                          {m.isCustom && (
                            <span className="text-[8px] px-1.5 py-0.2 bg-neutral-100 text-neutral-600 border border-neutral-300 rounded font-mono font-semibold">EIGENE</span>
                          )}
                          {isSel && (
                            <span className="text-[8px] px-2 py-0.5 bg-red-600 text-white rounded-full font-mono font-black tracking-wider">AKTIV</span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5 truncate">{m.spindle}</div>
                        {m.drawtube && <div className="text-[10px] text-neutral-400 font-mono mt-0.5">{m.drawtube}</div>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isSel && <Check size={16} className="text-red-600 shrink-0" />}
                        {m.isCustom && (
                          <button
                            onClick={(e) => handleDeleteCustom(m.id, e)}
                            className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                            title="Maschine löschen"
                          >
                            <Trash2 size={13} />
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
