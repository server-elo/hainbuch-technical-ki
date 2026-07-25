import { z } from "zod";

import { MAX_RPM } from "../config";
import { llmJson } from "../llm";
import { calculatePlan, type PlannedOperation } from "../machining";
import { powerLimitFactor } from "../clamping_check";
import type { EmitFn } from "../drawing";
import type { MaterialStage } from "./material";

export type RpmSource = "kunde" | "recherche" | "annahme";

/** Spindle limit: 1) customer stated an RPM, 2) customer named a machine →
 *  research its spec via the LLM's general knowledge, 3) standard assumption. */
async function resolveMachineSpec(
  plan: { maxSpindleSpeedRpm?: number | null; machinePowerKw?: number | null },
  machine: string | null,
  emit: EmitFn
) {
  let customerRpm =
    typeof plan.maxSpindleSpeedRpm === "number" &&
    plan.maxSpindleSpeedRpm >= 500 &&
    plan.maxSpindleSpeedRpm <= 60000
      ? Math.round(plan.maxSpindleSpeedRpm)
      : null;
  let rpmSource: RpmSource = customerRpm ? "kunde" : "annahme";
  let researchedKw: number | null = null;
  const customerKwEarly =
    typeof plan.machinePowerKw === "number" && plan.machinePowerKw >= 1 && plan.machinePowerKw <= 200;

  if (machine && (!customerRpm || !customerKwEarly)) {
    emit({ type: "info", label: `Maschinendaten werden recherchiert: ${machine}…` });
    try {
      const spec = (await llmJson(
        [
          {
            role: "system",
            content:
              "Du bist eine Werkzeugmaschinen-Datenbank. Nenne die maximale Drehzahl der Haupt-/Frässpindel der angefragten Maschine laut Herstellerangaben (Standardausführung). Wenn du die Maschine nicht sicher kennst, gib null zurück — NICHT raten.",
          },
          { role: "user", content: `Maschine: ${machine}` },
        ],
        z.object({
          maxSpindleRpm: z
            .number()
            .nullable()
            .describe("max. Spindeldrehzahl in 1/min laut Hersteller, sonst null"),
          spindlePowerKw: z
            .number()
            .nullable()
            .describe("Spindelleistung in kW laut Hersteller (Dauerleistung/S1 falls bekannt), sonst null"),
        }),
        "machine_spec"
      )) as { maxSpindleRpm: number | null; spindlePowerKw: number | null };
      if (
        typeof spec.maxSpindleRpm === "number" &&
        spec.maxSpindleRpm >= 500 &&
        spec.maxSpindleRpm <= 60000
      ) {
        customerRpm = Math.round(spec.maxSpindleRpm);
        rpmSource = "recherche";
        emit({ type: "info", label: `${machine}: max. ${customerRpm} 1/min (recherchiert)` });
      }
      if (
        typeof spec.spindlePowerKw === "number" &&
        spec.spindlePowerKw >= 1 &&
        spec.spindlePowerKw <= 200
      ) {
        researchedKw = Math.round(spec.spindlePowerKw * 10) / 10;
      }
    } catch (e) {
      console.warn("[Machine] spec lookup failed:", e);
    }
  }
  return { customerRpm, rpmSource, researchedKw };
}

/** Stage 3: deterministic calculation (no LLM math) + power limiting. */
export async function calculateOperations(args: {
  plan: any;
  material: MaterialStage;
  machine: string | null;
  emit: EmitFn;
}) {
  const { plan, material, machine, emit } = args;

  console.log(`[Pipeline] Stage 3: calculating ${plan.operations.length} operations`);
  emit({
    type: "status",
    stage: "calc",
    label: `${plan.operations.length} Operationen werden nach ISO-Formeln berechnet…`,
  });

  const { customerRpm, rpmSource, researchedKw } = await resolveMachineSpec(plan, machine, emit);
  const calc = calculatePlan(
    plan.operations as PlannedOperation[],
    material.materialKey,
    customerRpm ?? MAX_RPM
  );

  // Leistungs-Untergrenze (Fachkunde: Pe = Fc·vc/η, η = 0,8): Schrupp-Zeiten,
  // die mehr Schnittleistung bräuchten als die Maschine hat, werden angehoben.
  const customerKw =
    typeof plan.machinePowerKw === "number" && plan.machinePowerKw >= 1 && plan.machinePowerKw <= 200
      ? plan.machinePowerKw
      : null;
  const machineKw = customerKw ?? researchedKw ?? 15;
  const kwSource: RpmSource = customerKw ? "kunde" : researchedKw ? "recherche" : "annahme";
  const availableCuttingKw = machineKw * 0.8;
  const powerLimitedOps: string[] = [];
  for (const op of calc.operations) {
    // only ops with real depth evidence (explizite ap/ae, Volumen) oder Schruppen —
    // sonst würde die ap-Default-Annahme Schlichtzeiten künstlich aufblasen
    const roughingEvidence =
      op.apMm !== undefined || op.aeMm !== undefined ||
      (op.removalVolumeCm3 ?? 0) > 0 || /schrupp|rough/i.test(op.stepName);
    if (!roughingEvidence) continue;
    const f = powerLimitFactor(op as any, material.materialKey, availableCuttingKw);
    if (f > 1.05) {
      op.timeMin = Math.round(op.timeMin * f * 100) / 100;
      op.calculation += ` · leistungsbegrenzt auf ${machineKw} kW: Zeit ×${f.toFixed(2)} (Pe = Fc·vc/η, Fachkunde)`;
      powerLimitedOps.push(op.stepName);
    }
  }
  if (powerLimitedOps.length) {
    calc.totalCuttingTimeMin = Math.round(calc.operations.reduce((a, o) => a + o.timeMin, 0) * 100) / 100;
    calc.totalTimeMin = Math.round((calc.totalCuttingTimeMin + calc.toolChangeAllowanceMin) * 100) / 100;
  }

  return { calc, customerRpm, rpmSource, machineKw, kwSource, powerLimitedOps };
}

/** Spindle/power notes in German — translated by the caller if needed. */
export function machineNotes(args: {
  rpmSource: RpmSource;
  customerRpm: number | null;
  machine: string | null;
  conversation: string;
  powerLimitedOps: string[];
  machineKw: number;
  kwSource: RpmSource;
}): string[] {
  const { rpmSource, customerRpm, machine, conversation, powerLimitedOps, machineKw, kwSource } = args;
  const notes: string[] = [];
  if (rpmSource === "kunde") {
    notes.push(`Die Schnittdaten sind auf Ihre maximale Spindeldrehzahl von ${customerRpm} 1/min begrenzt.`);
  } else if (rpmSource === "recherche") {
    notes.push(`Für Ihre ${machine} habe ich eine max. Spindeldrehzahl von ${customerRpm} 1/min recherchiert und die Schnittdaten darauf begrenzt — bitte prüfen Sie den Wert an Ihrer Maschine.`);
  } else if (!conversation.includes("Spindeldrehzahl von")) {
    notes.push(`Hinweis: Ohne Angabe zu Ihrer Maschine habe ich mit einer üblichen max. Spindeldrehzahl von ${MAX_RPM} 1/min gerechnet. Nennen Sie mir Ihre Maschine, dann passe ich die Schnittdaten an.`);
  }
  if (powerLimitedOps.length) {
    notes.push(
      `⚡ Leistungs-Check (Pe = Fc·vc/η, Fachkunde): ${machineKw} kW ` +
        (kwSource === "kunde" ? "(Ihre Angabe)" : kwSource === "recherche" ? `(recherchiert für ${machine} — bitte prüfen)` : "(Annahme — nennen Sie die Spindelleistung Ihrer Maschine)") +
        ` reichen für ${powerLimitedOps.join(", ")} nicht bei vollen Schnittwerten — die Zeiten wurden entsprechend angehoben.`
    );
  }
  return notes;
}
