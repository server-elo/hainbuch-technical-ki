import React, { useState, useEffect } from 'react';
import { Cpu, ChevronDown, Check, Plus, Trash2, X, Save, Disc, Layers, ArrowRight, HelpCircle, Sparkles, Code2 } from 'lucide-react';

export interface MachineProfile {
  id: string;
  name: string;
  category: 'universal' | 'lathe' | 'mill' | 'millturn' | 'custom';
  type: 'lathe' | 'mill' | 'millturn';
  spindle: string;
  control?: string; // Siemens Sinumerik, Fanuc, Heidenhain, Mazatrol, etc.
  drawtube?: string;
  table?: string;
  isCustom?: boolean;
}

export const PRESET_MACHINES: MachineProfile[] = [
  // 1. UNIVERSAL-SPALTE (Automatische Erkennung)
  {
    id: 'univ-all',
    name: 'Universal (Automatische Auslegung)',
    category: 'universal',
    type: 'millturn',
    spindle: 'Universal-Flansch & Zylinder',
    control: 'Siemens Sinumerik & Fanuc ISO',
  },
  {
    id: 'univ-lathe-conv',
    name: 'Universal-Drehmaschine (Konventionell)',
    category: 'lathe',
    type: 'lathe',
    spindle: 'Kurzkegel / Camlock / DIN 55027',
    control: 'Manuell / Handspannfutter',
    drawtube: 'Hohlspindel / Handspannung',
  },
  {
    id: 'univ-cnc-lathe',
    name: 'Universal CNC-Drehmaschine (A2-6 / A2-8)',
    category: 'lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 / A2-8 (DIN 55026)',
    control: 'Siemens Sinumerik / Fanuc ISO',
    drawtube: 'Hohlspannzylinder Ø 65–80 mm',
  },
  {
    id: 'univ-cnc-mill',
    name: 'Universal CNC-Fräsmaschine / 5-Achs',
    category: 'mill',
    type: 'mill',
    spindle: 'T-Nutentisch 14/18 mm & 5-Achs-Rundtisch',
    control: 'Heidenhain TNC / Siemens 840D',
    table: 'T-Nuten 14/18 mm H7',
  },
  {
    id: 'univ-millturn',
    name: 'Universal Dreh-Fräszentrum (Mill-Turn)',
    category: 'millturn',
    type: 'millturn',
    spindle: 'Hauptspindel A2-6 + B-Achs Frässpindel',
    control: 'Siemens 840D / Mazatrol / Fanuc',
    drawtube: 'Hohlspannzylinder Ø 65–80 mm',
  },

  // 2. BEKANNTE DREHMASCHINEN
  {
    id: 'dmg-nlx2500',
    name: 'DMG Mori NLX 2500',
    category: 'lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'Siemens Sinumerik / MAPPS',
    drawtube: 'Hohlspannzylinder Ø 80 mm / M70x2',
  },
  {
    id: 'mazak-qt200',
    name: 'Mazak QuickTurn 200',
    category: 'lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'Mazatrol SmoothG / ISO',
    drawtube: 'Hohlspannzylinder Ø 65 mm / M60x2',
  },
  {
    id: 'haas-st20',
    name: 'Haas ST-20 / ST-30',
    category: 'lathe',
    type: 'lathe',
    spindle: 'Kurzkegel A2-6 (DIN 55026)',
    control: 'Haas NextGen Control (ISO)',
    drawtube: 'Hohlspannzylinder Ø 52 mm / M55x2',
  },

  // 3. BEKANNTE FRÄSMASCHINEN
  {
    id: 'hermle-c400',
    name: 'Hermle C400 (5-Achs BAZ)',
    category: 'mill',
    type: 'mill',
    spindle: '5-Achs Schwenkrundtisch Ø 440 mm',
    control: 'Heidenhain TNC 640',
    table: 'T-Nuten 14 mm H7 / 4 Kanäle',
  },
  {
    id: 'dmg-dmu50',
    name: 'DMG Mori DMU 50 (5-Achs)',
    category: 'mill',
    type: 'mill',
    spindle: '5-Achs Schwenkrundtisch Ø 500 mm',
    control: 'Siemens 840D / Heidenhain',
    table: 'T-Nuten 14 mm H7',
  },
];

const STORAGE_KEY = 'hainbuch_custom_machines';
const TUTORIAL_DISMISSED_KEY = 'hainbuch_machine_tutorial_dismissed';

interface Props {
  selected: MachineProfile;
  onSelect: (m: MachineProfile) => void;
}

export default function MachineSelector({ selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<'all' | 'lathe' | 'mill' | 'millturn'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [customMachines, setCustomMachines] = useState<MachineProfile[]>([]);

  // Registration Form State
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'lathe' | 'mill' | 'millturn'>('lathe');
  const [formSpindle, setFormSpindle] = useState('Kurzkegel A2-6 (DIN 55026 / ISO 702-1)');
  const [formControl, setFormControl] = useState('Siemens Sinumerik (840D / 828D / ONE)');
  const [formDrawtube, setFormDrawtube] = useState('');
  const [formTable, setFormTable] = useState('');

  // Check tutorial on mount
  useEffect(() => {
    try {
      const savedCustom = localStorage.getItem(STORAGE_KEY);
      if (savedCustom) setCustomMachines(JSON.parse(savedCustom));

      const dismissed = localStorage.getItem(TUTORIAL_DISMISSED_KEY);
      if (!dismissed) setShowTutorial(true);
    } catch {
      // ignore
    }
  }, []);

  const dismissTutorial = () => {
    setShowTutorial(false);
    try {
      localStorage.setItem(TUTORIAL_DISMISSED_KEY, 'true');
    } catch {
      // ignore
    }
  };

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
    setShowAddForm(false);
    setOpen(false);
    dismissTutorial();
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
    if (selected.id === id) onSelect(PRESET_MACHINES[0]);
  };

  // Filter machines based on active category tab
  const filteredPresets = PRESET_MACHINES.filter(m => {
    if (activeCategory === 'all') return true;
    if (activeCategory === 'lathe') return m.type === 'lathe';
    if (activeCategory === 'mill') return m.type === 'mill';
    if (activeCategory === 'millturn') return m.type === 'millturn';
    return true;
  });

  return (
    <div className="relative">
      
      {/* Premium Floating Tutorial Tooltip Hint */}
      {showTutorial && !open && (
        <div className="absolute top-full mt-2.5 right-0 z-40 w-80 bg-white text-neutral-900 text-xs p-4 rounded-2xl shadow-[0_12px_36px_-6px_rgba(0,0,0,0.18)] border-2 border-red-600 animate-in fade-in zoom-in-95 duration-200">
          {/* Arrow pointing up */}
          <div className="absolute -top-2.5 right-7 w-4 h-4 bg-white border-t-2 border-l-2 border-red-600 rotate-45"></div>
          
          <div className="flex items-start justify-between gap-2 relative z-10">
            <div className="flex items-center gap-1.5 font-black text-xs text-red-600 tracking-tight">
              <Sparkles size={14} className="text-red-600" />
              <span>MASCHINE & G-CODE WÄHLEN</span>
            </div>
            <button onClick={dismissTutorial} className="text-neutral-400 hover:text-neutral-700 p-0.5 rounded">
              <X size={14} />
            </button>
          </div>
          
          <p className="text-xs text-neutral-600 mt-2 leading-relaxed relative z-10">
            Wählen Sie hier Ihre Maschine (oder <strong>Universal</strong>), damit die KI automatisch die passenden <strong>Adapterflansche, Zugrohranbindungen</strong> und <strong>G-Code-Zyklen</strong> berechnet.
          </p>
          
          <div className="mt-3 flex items-center justify-end gap-2 relative z-10">
            <button
              onClick={dismissTutorial}
              className="px-2.5 py-1 text-xs text-neutral-500 hover:text-neutral-900 font-medium transition-colors"
            >
              Später
            </button>
            <button
              onClick={() => { dismissTutorial(); setOpen(true); }}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs shadow-sm active:scale-95 transition-all"
            >
              Jetzt wählen
            </button>
          </div>
        </div>
      )}

      {/* Main Machine Badge Button */}
      <button
        onClick={() => { setOpen(o => !o); dismissTutorial(); }}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-300/90 hover:border-red-600 shadow-sm hover:shadow transition-all group text-left h-9"
        title="CNC-Maschine & Spindelprofil konfigurieren"
      >
        <div className="w-5 h-5 rounded-md bg-red-50 text-red-600 flex items-center justify-center font-bold text-xs shrink-0 group-hover:scale-110 transition-transform">
          <Disc size={13} />
        </div>

        <div className="min-w-0 pr-0.5">
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Maschine:</span>
            <span className="text-[11px] font-bold text-neutral-900 truncate max-w-[100px] sm:max-w-[140px]">
              {selected.name.replace(/\s*\(.*\)/, '')}
            </span>
          </div>
        </div>

        <ChevronDown size={12} className={`text-neutral-400 group-hover:text-red-600 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover Card */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setShowAddForm(false); }} />
          <div className="absolute right-0 mt-2 w-96 max-w-[94vw] bg-white border border-neutral-200 rounded-2xl shadow-2xl z-50 overflow-hidden divide-y divide-neutral-100 text-neutral-800 animate-in fade-in zoom-in-95 duration-150">
            
            {/* Header & Category Tabs */}
            <div className="p-3.5 bg-neutral-50 border-b border-neutral-200">
              <div className="flex items-center justify-between mb-2.5">
                <div>
                  <h3 className="text-xs font-bold text-neutral-950 uppercase tracking-wider">Maschinen- & Spindelauswahl</h3>
                  <p className="text-[10px] text-neutral-500">Automatische Anpassung von Flanschen & G-Code</p>
                </div>
                <button
                  onClick={() => setShowAddForm(s => !s)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[10px] font-bold transition-all shadow-sm active:scale-95"
                >
                  <Plus size={11} />
                  Eigene Maschine
                </button>
              </div>

              {/* 4 Category Tabs */}
              <div className="grid grid-cols-4 gap-1 bg-neutral-200/70 p-1 rounded-lg text-[10px] font-bold text-center">
                <button
                  onClick={() => { setActiveCategory('all'); setShowAddForm(false); }}
                  className={`py-1 rounded-md transition-all ${activeCategory === 'all' && !showAddForm ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  🌟 Alle / Univ.
                </button>
                <button
                  onClick={() => { setActiveCategory('lathe'); setShowAddForm(false); }}
                  className={`py-1 rounded-md transition-all ${activeCategory === 'lathe' && !showAddForm ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  🔄 Drehen
                </button>
                <button
                  onClick={() => { setActiveCategory('mill'); setShowAddForm(false); }}
                  className={`py-1 rounded-md transition-all ${activeCategory === 'mill' && !showAddForm ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  ⚙️ Fräsen
                </button>
                <button
                  onClick={() => { setActiveCategory('millturn'); setShowAddForm(false); }}
                  className={`py-1 rounded-md transition-all ${activeCategory === 'millturn' && !showAddForm ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
                >
                  🔀 Dreh/Fräs
                </button>
              </div>
            </div>

            {/* Content: Form or Machine List */}
            {showAddForm ? (
              /* Custom Registration Form */
              <form onSubmit={handleSaveCustom} className="p-4 space-y-3 bg-neutral-50/40 text-xs">
                <div className="flex justify-between items-center pb-1 border-b border-neutral-200">
                  <span className="font-bold text-neutral-950 text-xs">Eigene Maschine konfigurieren</span>
                  <button type="button" onClick={() => setShowAddForm(false)} className="text-neutral-400 hover:text-neutral-700">
                    <X size={14} />
                  </button>
                </div>

                <div>
                  <label className="text-[10px] text-neutral-600 block mb-1 font-bold uppercase tracking-wider">
                    Maschinenhersteller & Modell *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="z. B. Spinner TC600, Index G200, EMAG"
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
                    CNC-Steuerung & G-Code-Format
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
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-1.5 text-xs text-neutral-500 hover:text-neutral-900 font-medium"
                  >
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold shadow-sm"
                  >
                    <Save size={12} />
                    Speichern & Aktivieren
                  </button>
                </div>
              </form>
            ) : (
              /* Machine Cards List */
              <div className="max-h-80 overflow-y-auto p-2.5 space-y-1.5">
                
                {/* Custom user machines */}
                {customMachines.length > 0 && activeCategory === 'all' && (
                  <div className="mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-neutral-400 px-1 block mb-1">Meine konfigurierten Maschinen</span>
                    {customMachines.map((m) => {
                      const isSel = m.id === selected.id;
                      return (
                        <div
                          key={m.id}
                          onClick={() => { onSelect(m); setOpen(false); }}
                          className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between mb-1 ${
                            isSel ? 'bg-red-50/80 border-red-500 text-red-950 shadow-sm' : 'bg-white border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50'
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
                )}

                {/* Preset List */}
                {filteredPresets.map((m) => {
                  const isSel = m.id === selected.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => { onSelect(m); setOpen(false); }}
                      className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSel ? 'bg-red-50/80 border-red-500 text-red-950 shadow-sm' : 'bg-white border-neutral-200/80 hover:border-neutral-300 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-neutral-900 truncate">{m.name}</span>
                          {isSel && <span className="text-[8px] px-1.5 py-0.2 bg-red-600 text-white rounded font-mono font-bold">AKTIV</span>}
                        </div>
                        <div className="text-[10px] text-neutral-500 mt-0.5">{m.spindle}</div>
                        {m.control && (
                          <div className="text-[9px] text-neutral-400 font-mono mt-0.5 flex items-center gap-1">
                            <Code2 size={10} className="text-red-500 shrink-0" />
                            <span>{m.control}</span>
                          </div>
                        )}
                      </div>
                      {isSel && <Check size={16} className="text-red-600 shrink-0" />}
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
