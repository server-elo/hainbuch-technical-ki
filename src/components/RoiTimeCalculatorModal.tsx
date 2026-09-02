import React, { useState } from 'react';
import { X, TrendingDown, Clock, Euro, CheckCircle2, AlertTriangle, ArrowRight, Zap, RefreshCw } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  defaultBatchSize?: number;
}

export default function RoiTimeCalculatorModal({ isOpen, onClose, defaultBatchSize = 250 }: Props) {
  const [batchSize, setBatchSize] = useState<number>(defaultBatchSize);
  const [machineType, setMachineType] = useState<'lathe' | 'mill'>('lathe');
  const [hourlyRate, setHourlyRate] = useState<number>(95);
  const [partValue, setPartValue] = useState<number>(35);

  if (!isOpen) return null;

  // Parameter Benchmarks
  const isLathe = machineType === 'lathe';

  // Option 1: HAINBUCH Universal System (SPANNTOP / TOPlus / InoFlex)
  const hbSetupTimeMin = 2.0; // < 2 min per collet change
  const hbCycleTimeSec = isLathe ? 48 : 120; // 20% faster due to damping
  const hbScrapPercent = 0.3; // virtually zero scrap

  // Option 2: Konventionelles Dreibackenfutter / Standardschraubstock
  const convSetupTimeMin = isLathe ? 45.0 : 35.0; // ausdrehen / einmessen
  const convCycleTimeSec = isLathe ? 62 : 155; // slower feeds to avoid chatter
  const convScrapPercent = isLathe ? 8.5 : 6.0; // polygon / deformation scrap

  // Option 3: Konventionelle Standard-Spannzange (z.B. DIN 6343 / Fremdsystem)
  const colletSetupTimeMin = 20.0;
  const colletCycleTimeSec = isLathe ? 54 : 138;
  const colletScrapPercent = 3.5;

  // Calculations for HAINBUCH
  const hbTotalMachiningHours = (batchSize * hbCycleTimeSec) / 3600;
  const hbTotalSetupHours = hbSetupTimeMin / 60;
  const hbTotalHours = hbTotalMachiningHours + hbTotalSetupHours;
  const hbScrapParts = Math.round(batchSize * (hbScrapPercent / 100));
  const hbCost = (hbTotalHours * hourlyRate) + (hbScrapParts * partValue);

  // Calculations for Konventionell (Backenfutter / Schraubstock)
  const convTotalMachiningHours = (batchSize * convCycleTimeSec) / 3600;
  const convTotalSetupHours = convSetupTimeMin / 60;
  const convTotalHours = convTotalMachiningHours + convTotalSetupHours;
  const convScrapParts = Math.round(batchSize * (convScrapPercent / 100));
  const convCost = (convTotalHours * hourlyRate) + (convScrapParts * partValue);

  // Calculations for Konventionelle Zange
  const colletTotalMachiningHours = (batchSize * colletCycleTimeSec) / 3600;
  const colletTotalSetupHours = colletSetupTimeMin / 60;
  const colletTotalHours = colletTotalMachiningHours + colletTotalSetupHours;
  const colletScrapParts = Math.round(batchSize * (colletScrapPercent / 100));
  const colletCost = (colletTotalHours * hourlyRate) + (colletScrapParts * partValue);

  // Savings
  const savedHours = Math.max(0, convTotalHours - hbTotalHours);
  const savedCost = Math.max(0, convCost - hbCost);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white text-neutral-900 w-full max-w-5xl rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden flex flex-col my-auto max-h-[92dvh]">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 bg-neutral-50 border-b border-neutral-200 shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center font-bold text-white tracking-wider text-xs shadow-sm shrink-0">
              HB
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold tracking-tight text-neutral-950">Wirtschaftlichkeits- & Zeitrechner</h2>
              <p className="text-[11px] sm:text-xs text-neutral-500 hidden xs:block">Direkter Spaltenvergleich: HAINBUCH Universal vs. Konventionelle Spanntechnik</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-200 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Modal Controls Bar */}
        <div className="p-3.5 sm:p-5 bg-neutral-100/60 border-b border-neutral-200 grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4 text-xs shrink-0">
          <div className="col-span-2 sm:col-span-1">
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Maschinenart</label>
            <div className="flex bg-white p-0.5 rounded-lg border border-neutral-300 shadow-sm">
              <button
                onClick={() => setMachineType('lathe')}
                className={`flex-1 py-1 text-xs font-bold rounded-md transition-colors ${machineType === 'lathe' ? 'bg-red-600 text-white shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
              >
                🔄 Dreh
              </button>
              <button
                onClick={() => setMachineType('mill')}
                className={`flex-1 py-1 text-xs font-bold rounded-md transition-colors ${machineType === 'mill' ? 'bg-red-600 text-white shadow-sm' : 'text-neutral-600 hover:text-neutral-900'}`}
              >
                ⚙️ Fräs
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Losgröße (Stk.)</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={batchSize}
              onChange={e => setBatchSize(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs text-neutral-900 font-bold focus:outline-none focus:border-red-600 shadow-sm"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Stundensatz (€/h)</label>
            <input
              type="number"
              min={20}
              max={500}
              value={hourlyRate}
              onChange={e => setHourlyRate(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs text-neutral-900 font-bold focus:outline-none focus:border-red-600 shadow-sm"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 block mb-1">Materialwert (€)</label>
            <input
              type="number"
              min={1}
              max={5000}
              value={partValue}
              onChange={e => setPartValue(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full bg-white border border-neutral-300 rounded-lg px-2.5 py-1.5 text-xs text-neutral-900 font-bold focus:outline-none focus:border-red-600 shadow-sm"
            />
          </div>
        </div>

        {/* Comparison Table with 3 Columns */}
        <div className="p-3.5 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 scroll-thin">
          
          {/* Key Metric Highlights Box */}
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <Zap size={18} />
              </div>
              <div>
                <span className="text-[10px] sm:text-[11px] font-bold text-emerald-800 uppercase tracking-wider block">Ihre Ersparnis bei {batchSize} Werkstücken:</span>
                <div className="text-base sm:text-xl font-black text-emerald-950 leading-tight">
                  {savedHours.toFixed(1)} h Zeitersparnis &amp; {savedCost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
            <div className="self-end sm:self-center">
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-white px-2.5 py-1 rounded-md border border-emerald-200 shadow-sm">
                <CheckCircle2 size={13} /> {((savedCost / Math.max(1, convCost)) * 100).toFixed(0)} % Ersparnis
              </span>
            </div>
          </div>

          {/* The 3 Columns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            
            {/* SPALTE 1: HAINBUCH Universal (Empfehlung) */}
            <div className="border-2 border-red-600 rounded-xl p-4 bg-red-50/20 shadow-md relative flex flex-col justify-between">
              <div className="absolute -top-3 left-4 bg-red-600 text-white text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm">
                1. Universal (HAINBUCH)
              </div>
              <div>
                <h3 className="font-bold text-sm text-neutral-900 mt-1 mb-0.5">
                  {isLathe ? 'SPANNTOP / TOPlus System' : 'MANOK plus / InoFlex VF'}
                </h3>
                <p className="text-[11px] text-neutral-500 mb-3">360°-Umschlingung & Schwingungsdämpfung</p>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-neutral-200">
                    <span className="text-neutral-600">Rüstzeit gesamt:</span>
                    <strong className="text-emerald-700 font-mono">{hbSetupTimeMin.toFixed(1)} min</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200">
                    <span className="text-neutral-600">Taktzeit je Werkstück:</span>
                    <strong className="text-neutral-900 font-mono">{hbCycleTimeSec} s</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200">
                    <span className="text-neutral-600">Ausschussquote:</span>
                    <strong className="text-emerald-700 font-mono">&lt; 0,5 % ({hbScrapParts} Stk.)</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200">
                    <span className="text-neutral-600">Gesamte Loszeit:</span>
                    <strong className="text-neutral-900 font-mono">{hbTotalHours.toFixed(2)} h</strong>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t-2 border-red-200">
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block">Gesamtkosten für {batchSize} Stk.:</span>
                <div className="text-lg font-black text-red-700 font-mono">
                  {hbCost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>

            {/* SPALTE 2: Konventionell (Dreibackenfutter / Schraubstock) */}
            <div className="border border-neutral-300 rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                  2. Konventionell
                </span>
                <h3 className="font-bold text-sm text-neutral-800 mb-0.5">
                  {isLathe ? 'Standard-3-Backenfutter' : 'Standard-Maschinenschraubstock'}
                </h3>
                <p className="text-[11px] text-neutral-500 mb-3">Punktuelle Krafteinleitung mit Dreiecksverzug</p>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Rüstzeit gesamt:</span>
                    <strong className="text-neutral-900 font-mono">{convSetupTimeMin.toFixed(0)} min</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Taktzeit je Werkstück:</span>
                    <strong className="text-neutral-900 font-mono">{convCycleTimeSec} s</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Ausschussquote:</span>
                    <strong className="text-red-600 font-mono">~ {convScrapPercent} % ({convScrapParts} Stk.)</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Gesamte Loszeit:</span>
                    <strong className="text-neutral-900 font-mono">{convTotalHours.toFixed(2)} h</strong>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-neutral-200">
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block">Gesamtkosten für {batchSize} Stk.:</span>
                <div className="text-lg font-bold text-neutral-800 font-mono">
                  {convCost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>

            {/* SPALTE 3: Konventionelle Spannzange / Fremdsystem */}
            <div className="border border-neutral-300 rounded-xl p-4 bg-white shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block mb-1">
                  3. Konventionelle Zange
                </span>
                <h3 className="font-bold text-sm text-neutral-800 mb-0.5">
                  DIN 6343 Druckzange / Fremdzange
                </h3>
                <p className="text-[11px] text-neutral-500 mb-3">Reine Reibspannung ohne Niederzug</p>

                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Rüstzeit gesamt:</span>
                    <strong className="text-neutral-900 font-mono">{colletSetupTimeMin.toFixed(0)} min</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Taktzeit je Werkstück:</span>
                    <strong className="text-neutral-900 font-mono">{colletCycleTimeSec} s</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Ausschussquote:</span>
                    <strong className="text-amber-600 font-mono">~ {colletScrapPercent} % ({colletScrapParts} Stk.)</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-100">
                    <span className="text-neutral-600">Gesamte Loszeit:</span>
                    <strong className="text-neutral-900 font-mono">{colletTotalHours.toFixed(2)} h</strong>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-neutral-200">
                <span className="text-[10px] text-neutral-500 uppercase font-semibold block">Gesamtkosten für {batchSize} Stk.:</span>
                <div className="text-lg font-bold text-neutral-800 font-mono">
                  {colletCost.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
