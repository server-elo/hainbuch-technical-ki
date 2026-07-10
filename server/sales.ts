/** Sales layer: turn a technically correct recommendation into a complete
 *  HAINBUCH package — ecosystem accessories, automation upsell with the
 *  existing amortization logic, and concrete next steps. All suggestions are
 *  grounded in catalogue product families (deterministic map, no LLM). */

export interface EcosystemSuggestion {
  category: string;
  suggestion: string;
  reason: string;
}

const FAMILY = (name: string) => {
  const n = name.toLowerCase();
  if (/toplus|spanntop/.test(n)) return "futter";
  if (/mando|maxxos/.test(n)) return "dorn";
  if (/manok|hydrok|inoflex vf|zentrischspanner|spannstock/.test(n)) return "stationaer";
  if (/torok|inoflex vd/.test(n)) return "handspann";
  if (/b-top|backenfutter/.test(n)) return "backen";
  return "";
};

/** Ecosystem: what a HAINBUCH sales engineer always mentions with the family. */
export function ecosystemFor(productName: string, batchSize: number | null): EcosystemSuggestion[] {
  const fam = FAMILY(productName);
  const out: EcosystemSuggestion[] = [];
  const big = (batchSize ?? 0) >= 200;

  if (fam === "futter") {
    out.push({
      category: "Spannköpfe",
      suggestion: "Passende Spannköpfe (SE sechseckig / RD rund) für Roh- und Fertigmaß",
      reason: "Pro Spanndurchmesser ein Kopf — Wechsel in Sekunden, Rundlauf bleibt",
    });
    out.push({
      category: "Wechselsystem",
      suggestion: "centroteX S/M Schnellwechsel-Schnittstelle",
      reason: big
        ? "Bei Serienfertigung: Spannmittelwechsel in Minuten statt Stunden — auftragsorientiert fertigen"
        : "Lohnt ab regelmäßigem Spannmittelwechsel zwischen Aufträgen",
    });
    out.push({
      category: "Messtechnik",
      suggestion: "TESTit Spannkraftmessung",
      reason: "Dokumentierte Spannkraft = Prozesssicherheit (und Pflicht nach VDI 3106 bei kritischen Teilen)",
    });
  }
  if (fam === "dorn") {
    out.push({
      category: "Adaption",
      suggestion: "MANDO Adapt für den Einsatz im vorhandenen Backenfutter",
      reason: "Innenspannung ohne Maschinenumbau — Dorn-im-Futter in Minuten gerüstet",
    });
    out.push({
      category: "Segmentspannbüchsen",
      suggestion: "Segmentspannbüchsen für jeden Bohrungsdurchmesser",
      reason: "Verschleißteil — Zweitgarnitur vermeidet Stillstand",
    });
  }
  if (fam === "stationaer") {
    if (big)
      out.push({
        category: "Mehrfachspannung",
        suggestion: "Mehrfachspannplatten für Paketbearbeitung",
        reason: "Mehrere Teile pro Aufspannung = Werkzeugwechsel amortisieren sich über das Paket",
      });
    out.push({
      category: "Nullpunkt",
      suggestion: "Grundplatte/Nullpunktspannsystem für wiederholgenaues Umrüsten",
      reason: "Rüstzeit je Auftrag von Minuten auf Sekunden",
    });
    out.push({
      category: "Spannköpfe",
      suggestion: "Spannkopf-Satz für die vorkommenden Spanndurchmesser",
      reason: "Ein Spannstock, viele Werkstücke",
    });
  }
  if (fam === "handspann") {
    out.push({
      category: "Zubehör",
      suggestion: "Wechselvorrichtung + Ausricht-Set",
      reason: "Kopfwechsel ohne Kran, µm-genaues Einsetzen",
    });
  }
  return out.slice(0, 3);
}

/** Automation nudge: only when the batch size justifies it — honest, with the
 *  cost-compare numbers the pipeline already computes. */
export function automationNudge(batchSize: number | null, hasManualRec: boolean): string | null {
  if (!batchSize || batchSize < 100) return null;
  if (!hasManualRec) return null; // already automated — nothing to nudge
  return (
    `Bei ${batchSize} Stück lohnt der Blick auf Automatisierung: kraft-/hydraulikbetätigte ` +
    `Spannmittel sparen je Teil ~0,6 min Handling (siehe Kostenvergleich oben) und machen ` +
    `Roboterbeladung möglich. Gern rechnen wir die Amortisation für Ihre Folgeserien.`
  );
}
