import React, { useState, useEffect } from 'react';
import { Cpu, ChevronDown, Check, Plus, Trash2, X, Save, Disc, Layers, Sliders, Wrench, Code2 } from 'lucide-react';

export interface MachineProfile {
  id: string;
  name: string;
  category: 'universal' | 'cnc-lathe' | 'cnc-mill' | 'cnc-millturn' | 'custom';
  type: 'lathe' | 'mill' | 'millturn';
  spindle: string;
  control?: string; // e.g. Siemens Sinumerik, Fanuc, Heidenhain, Mazatrol
  drawtube?: string;
  table?: string;
  isCustom?: boolean;
}

export const PRESET_MACHINES: MachineProfile[] = [
  // UNIVERSAL & STANDARD (Wenn Modell nicht genau bekannt)
  {
    id: 'univ-lathe-conv',
    name: 'Universal-Drehmaschine (Konventionell)',
    category: 'universal',
    type: 'lathe',
    spindle: 'Kurzkegel / Camlock / DIN 55027',
    control: 'Manuell / Zyklen',
    drawtube: 'Manuell / Hohlspindel',
  },
  {
    id: 'univ-cnc-lathe-a26',
    name: 'CNC-Drehmaschine Universal (A2-6)',
    category: 'cnc-lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'Siemens Sinumerik / Fanuc / ISO',
    drawtube: 'Hohlspannzylinder Ø 65–80 mm',
  },
  {
    id: 'univ-cnc-lathe-a28',
    name: 'CNC-Drehmaschine Universal (A2-8)',
    category: 'cnc-lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-8 (DIN 55026)',
    control: 'Siemens Sinumerik / Fanuc / ISO',
    drawtube: 'Hohlspannzylinder Ø 80–100 mm',
  },
  {
    id: 'univ-cnc-mill-5axis',
    name: 'CNC-5-Achs-BAZ Universal (Fräsen)',
    category: 'cnc-mill',
    type: 'mill',
    spindle: 'Schwenkrundtisch Ø 400–600 mm',
    control: 'Heidenhain / Siemens / Fanuc',
    table: 'T-Nuten 14/18 mm H7',
  },
  {
    id: 'univ-cnc-millturn',
    name: 'CNC-Dreh-Fräszentrum (Mill-Turn)',
    category: 'cnc-millturn',
    type: 'millturn',
    spindle: 'Hauptspindel A2-6 + B-Achs Frässpindel',
    control: 'Siemens 840D / Mazatrol / Fanuc',
    drawtube: 'Hohlspannzylinder Ø 65 mm',
  },
  // BEKANNTE MODELL-BEISPIELE
  {
    id: 'dmg-nlx2500',
    name: 'DMG Mori NLX 2500',
    category: 'cnc-lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'CELOS / MAPPS / Siemens',
    drawtube: 'Hohlspannzylinder Ø 80 mm / M70x2',
  },
  {
    id: 'mazak-qt200',
    name: 'Mazak QuickTurn 200',
    category: 'cnc-lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'SmoothG / Mazatrol',
    drawtube: 'Hohlspannzylinder Ø 65 mm / M60x2',
  },
  {
    id: 'haas-st20',
    name: 'Haas ST-20 / ST-30',
    category: 'cnc-lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'Haas NextGen (ISO G-Code)',
    drawtube: 'Hohlspannzylinder Ø 52 mm / M55x2',
  },
  {
    id: 'hermle-c400',
    name: 'Hermle C400 (5-Achs)',
    category: 'cnc-mill',
    type: 'mill',
    spindle: '5-Achs Rundtisch Ø 440 mm',
    control: 'Heidenhain TNC 640',
    table: 'T-Nuten 14 mm H7 / 4 Kanäle',
  },
];

const STORAGE_KEY = 'hainbuch_custom_machines';

interface Props {
  selected: MachineProfile;
  onSelect: (m: MachineProfile) => void;
}

export default function MachineSelector({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'standard' | 'register'>('standard');
  const [customMachines, setCustomMachines] = useState<MachineProfile[]>([]);

  // Registration Form State
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'lathe' | 'mill' | 'millturn'>('lathe');
  const [formSpindle, setFormSpindle] = useState('Kurzkegel A2-6 (DIN 55026 / ISO 702-1)');
  const [formControl, setFormControl] = useState('Siemens Sinumerik (840D / 828D)');
  const [formDrawtube, setFormDrawtube] = useState('');
  const [formTable, setFormTable] = useState('');

  // Extract short spindle tag
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
      if (saved) setCustomMachines(JSON.parse(saved));
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
      category: 'custom',
      type: formType,
      spindle: formSpindle.trim(),
      control: formControl.trim(),
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
    setOpen(false);
    setActiveTab('standard');
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
    if (selected.id === id) onSelect(PRESET_MACHINES[1]);
  };

  return (
    <div className="relative">
      {/* Industrial Machine Pill Button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200/90 hover:border-red-500 shadow-sm hover:shadow transition-all group text-left"
        title="CNC-Maschine, Spindelschnittstelle & G-Code-Steuerung wählen"
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

      {/* Popover Card */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-96 max-w-[92vw] bg-white border border-neutral-200/90 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-neutral-100 animate-in fade-in zoom-in-95 duration-150 text-neutral-800">
            
            {/* Header with 2 Tabs */}
            <div className="p-3 bg-neutral-50 border-b border-neutral-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-bold tracking-wider text-neutral-500 uppercase">Maschinenpark & Steuerung</span>
                <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-700">
                  <X size={14} />
                </button>
              </div>

              {/* 2 Tabs */}
              <div className="flex bg-neutral-200/60 p-1 rounded-lg text-xs font-semibold">
                <button
                  onClick={() => setActiveTab('standard')}
                  className={`flex-1 py-1.5 rounded-md transition-all ${
                    activeTab === 'standard' ? 'bg-white text-neutral-950 shadow-sm font-bold' : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  Universal & Standards
                </button>
                <button
                  onClick={() => setActiveTab('register')}
                  className={`flex-1 py-1.5 rounded-md flex items-center justify-center gap-1 transition-all ${
                    activeTab === 'register' ? 'bg-red-600 text-white shadow-sm font-bold' : 'text-neutral-600 hover:text-red-700'
                  }`}
                >
                  <Plus size={12} />
                  Eigene Maschine registrieren
                </button>
              </div>
            </div>

            {/* TAB 1: Universal & Standard Machines */}
            {activeTab === 'standard' ? (
              <div className="max-h-80 overflow-y-auto p-2 space-y-3">
                
                {/* Custom User Machines (if any) */}
                {customMachines.length > 0 && (
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 px-2 block mb-1">Meine registrierten Maschinen</span>
                    <div className="space-y-1">
                      {customMachines.map((m) => {
                        const isSel = m.id === selected.id;
                        return (
                          <div
                            key={m.id}
                            onClick={() => { onSelect(m); setOpen(false); }}
                            className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                              isSel ? 'bg-red-50/70 border-red-500 text-red-950 shadow-sm' : 'bg-white border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-xs text-neutral-900 truncate">{m.name}</span>
                                <span className="text-[8px] px-1.5 py-0.2 bg-neutral-100 text-neutral-600 rounded font-mono">EIGENE</span>
                                {isSel && <span className="text-[8px] px-1.5 py-0.2 bg-red-600 text-white rounded font-mono font-bold">AKTIV</span>}
                              </div>
                              <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{m.spindle} | Steuerung: {m.control || 'G-Code'}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              {isSel && <Check size={16} className="text-red-600 shrink-0" />}
                              <button
                                onClick={(e) => handleDeleteCustom(m.id, e)}
                                className="p-1 text-neutral-400 hover:text-red-600 transition-colors rounded"
                                title="Löschen"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Section 1: Universal / Keine Modellkenntnis */}
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 px-2 block mb-1">
                    Universal-Profile (Wenn Modell nicht genau bekannt)
                  </span>
                  <div className="space-y-1">
                    {PRESET_MACHINES.slice(0, 5).map((m) => {
                      const isSel = m.id === selected.id;
                      return (
                        <div
                          key={m.id}
                          onClick={() => { onSelect(m); setOpen(false); }}
                          className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                            isSel ? 'bg-red-50/70 border-red-500 text-red-950 shadow-sm' : 'bg-white border-neutral-200/80 hover:border-neutral-300 hover:bg-neutral-50'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-neutral-900 truncate">{m.name}</span>
                              {isSel && <span className="text-[8px] px-1.5 py-0.2 bg-red-600 text-white rounded font-mono font-bold">AKTIV</span>}
                            </div>
                            <div className="text-[10px] text-neutral-500 mt-0.5">{m.spindle}</div>
                            <div className="text-[9px] text-neutral-400 font-mono mt-0.5 flex items-center gap-1">
                              <Code2 size={10} className="text-red-500" />
                              G-Code: {m.control}
                            </div>
                          </div>
                          {isSel && <Check size={16} className="text-red-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Section 2: Häufige CNC-Modelle */}
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 px-2 block mb-1">
                    Bekannte CNC-Modelle
                  </span>
                  <div className="space-y-1">
                    {PRESET_MACHINES.slice(5).map((m) => {
                      const isSel = m.id === selected.id;
                      return (
                        <div
                          key={m.id}
                          onClick={() => { onSelect(m); setOpen(false); }}
                          className={`w-full text-left p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                            isSel ? 'bg-red-50/70 border-red-500 text-red-950 font-semibold' : 'bg-white border-neutral-200/80 hover:border-neutral-300 hover:bg-neutral-50'
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-xs text-neutral-900 block truncate">{m.name}</span>
                            <span className="text-[10px] text-neutral-500 block truncate">{m.spindle} | {m.control}</span>
                          </div>
                          {isSel && <Check size={15} className="text-red-600 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            ) : (
              /* TAB 2: Registration Form (Eigene Maschine registrieren) */
              <form onSubmit={handleSaveCustom} className="p-4 space-y-3 bg-neutral-50/40 text-xs">
                <div>
                  <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider">
                    1. Maschinenhersteller & Modell *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="z. B. Spinner TC600, Index G200, EMAG, DMG"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 font-medium focus:outline-none focus:border-red-600 shadow-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider">Maschinentyp</label>
                    <select
                      value={formType}
                      onChange={e => setFormType(e.target.value as any)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-neutral-900 font-medium focus:outline-none focus:border-red-600 shadow-sm"
                    >
                      <option value="lathe">🔄 Drehmaschine</option>
                      <option value="mill">⚙️ Fräsmaschine / BAZ</option>
                      <option value="millturn">🔀 Dreh-Fräszentrum</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider">Spindelnase</label>
                    <select
                      value={formSpindle}
                      onChange={e => setFormSpindle(e.target.value)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-neutral-900 font-medium focus:outline-none focus:border-red-600 shadow-sm"
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

                <div>
                  <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider flex items-center gap-1">
                    <Code2 size={12} className="text-red-600" />
                    2. CNC-Steuerung & G-Code-Format
                  </label>
                  <select
                    value={formControl}
                    onChange={e => setFormControl(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-lg px-2 py-1.5 text-xs text-neutral-900 font-medium focus:outline-none focus:border-red-600 shadow-sm"
                  >
                    <option value="Siemens Sinumerik (840D / 828D / ONE)">Siemens Sinumerik (CYCLE95 / CYCLE97 / SLOT1)</option>
                    <option value="Heidenhain (TNC 640 / iTNC 530)">Heidenhain Klartext / ISO</option>
                    <option value="Fanuc / DIN ISO Standard (G71 / G76)">Fanuc / DIN ISO Standard (G71 / G76 / G83)</option>
                    <option value="Mazak Mazatrol / Matrix">Mazak Mazatrol / ISO</option>
                    <option value="Haas CNC Control">Haas NextGen Control</option>
                    <option value="Okuma OSP">Okuma OSP</option>
                  </select>
                </div>

                {formType !== 'mill' ? (
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider">Zugrohr & Zylinder (optional)</label>
                    <input
                      type="text"
                      placeholder="z. B. Ø 65 mm Hohlspannzylinder / Gewinde M60x2"
                      value={formDrawtube}
                      onChange={e => setFormDrawtube(e.target.value)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider">Frästisch-Spezifikation</label>
                    <input
                      type="text"
                      placeholder="z. B. T-Nuten 14 mm H7 / 4 Kanäle"
                      value={formTable}
                      onChange={e => setFormTable(e.target.value)}
                      className="w-full bg-white border border-neutral-300 rounded-lg px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-red-600 shadow-sm"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setActiveTab('standard')}
                    className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 font-medium"
                  >
                    Zurück
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all"
                  >
                    <Save size={12} />
                    Maschine speichern & aktivieren
                  </button>
                </div>
              </form>
            )}

          </div>
        </>
      )}
    </div>
  );
}
