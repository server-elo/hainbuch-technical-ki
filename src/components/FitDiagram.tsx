import { motion } from 'motion/react';
import type { FitSolution } from '../types';

/** ISO 286 tolerance-field diagram (Toleranzfelder zur Nulllinie) rendered
 *  from code-computed fit data — the classic Tabellenbuch visualization. */
export default function FitDiagram({ fit }: { fit: FitSolution }) {
  const nominal = Math.round(fit.holeGu); // H-field: Gu == Nennmaß
  const devUm = (v: number) => Math.round((v - nominal) * 1000);

  const holeTop = devUm(fit.holeGo);
  const holeBot = devUm(fit.holeGu);
  const shaftTop = devUm(fit.shaftGo);
  const shaftBot = devUm(fit.shaftGu);

  const lo = Math.min(holeBot, shaftBot, 0);
  const hi = Math.max(holeTop, shaftTop, 0);
  const span = Math.max(hi - lo, 1);

  const H = 170;
  const PAD = 24;
  const scale = (H - 2 * PAD) / span;
  const y = (um: number) => PAD + (hi - um) * scale;

  const zero = y(0);
  const isClearance = fit.psh > 0 && fit.puh >= 0;

  return (
    <div className="border border-neutral-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider">
          Passung {fit.designation}
        </h4>
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
            isClearance
              ? 'bg-green-50 text-green-700 border-green-200'
              : fit.psh <= 0
                ? 'bg-red-50 text-red-700 border-red-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          {fit.fitType}
        </span>
      </div>
      <div className="flex gap-4 flex-wrap sm:flex-nowrap">
        <svg viewBox="0 0 240 190" className="w-full max-w-[260px]">
          {/* Nulllinie */}
          <line x1="8" y1={zero} x2="232" y2={zero} stroke="#a3a3a3" strokeWidth="1" strokeDasharray="4 3" />
          <text x="10" y={zero - 4} fill="#737373" fontSize="8">
            Nulllinie (∅{nominal})
          </text>

          {/* Bohrung field */}
          <motion.rect
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            x="55"
            y={y(holeTop)}
            width="55"
            height={Math.max(2, (holeTop - holeBot) * scale)}
            fill="#0284c7"
            fillOpacity="0.15"
            stroke="#0284c7"
            strokeWidth="1.2"
          />
          <text x="82" y={y(holeTop) - 5} fill="#0369a1" fontSize="9" textAnchor="middle" fontWeight="600">
            Bohrung
          </text>
          <text x="115" y={y(holeTop) + 3} fill="#0369a1" fontSize="8">
            +{holeTop} µm
          </text>
          <text x="115" y={y(holeBot) + 3} fill="#0369a1" fontSize="8">
            {holeBot >= 0 ? '+' : ''}{holeBot} µm
          </text>

          {/* Welle field */}
          <motion.rect
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            x="150"
            y={y(shaftTop)}
            width="55"
            height={Math.max(2, (shaftTop - shaftBot) * scale)}
            fill="#dc2626"
            fillOpacity="0.12"
            stroke="#dc2626"
            strokeWidth="1.2"
          />
          <text x="177" y={y(shaftTop) - 5} fill="#b91c1c" fontSize="9" textAnchor="middle" fontWeight="600">
            Welle
          </text>
          <text x="209" y={y(shaftTop) + 3} fill="#b91c1c" fontSize="8">
            {shaftTop >= 0 ? '+' : ''}{shaftTop} µm
          </text>
          <text x="209" y={y(shaftBot) + 3} fill="#b91c1c" fontSize="8">
            {shaftBot >= 0 ? '+' : ''}{shaftBot} µm
          </text>
        </svg>
        <div className="grid grid-cols-2 sm:flex sm:flex-col justify-center gap-2.5 text-xs w-full sm:w-auto sm:min-w-[130px]">
          <div>
            <p className="text-neutral-400 text-[10px] uppercase tracking-wide font-semibold">Höchstspiel</p>
            <p className="font-mono text-neutral-900">{fit.psh.toFixed(3).replace('.', ',')} mm</p>
          </div>
          <div>
            <p className="text-neutral-400 text-[10px] uppercase tracking-wide font-semibold">
              {fit.puh < 0 ? 'Höchstübermaß' : 'Mindestspiel'}
            </p>
            <p className="font-mono text-neutral-900">{fit.puh.toFixed(3).replace('.', ',')} mm</p>
          </div>
          <div className="col-span-2">
            <p className="text-neutral-400 text-[10px] uppercase tracking-wide font-semibold">Grenzmaße</p>
            <p className="font-mono text-[10px] text-sky-700">
              Bohrung {fit.holeGo.toFixed(3).replace('.', ',')} / {fit.holeGu.toFixed(3).replace('.', ',')}
            </p>
            <p className="font-mono text-[10px] text-red-700">
              Welle {fit.shaftGo.toFixed(3).replace('.', ',')} / {fit.shaftGu.toFixed(3).replace('.', ',')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
