import { llmText } from "./llm";
import { LANGUAGE_NAMES, type Language } from "./intent";
import { clientAborted } from "./abort";

/** Heading above the deterministic ISO 286 fit block (numbers stay untouched). */
const FIT_HEADER: Record<Language, string> = {
  de: "Passung nach ISO 286 (deterministisch berechnet)",
  en: "Fit per ISO 286 (calculated)",
  zh: "ISO 286 配合（确定性计算）",
  es: "Ajuste según ISO 286 (calculado)",
  fr: "Ajustement selon ISO 286 (calculé)",
  it: "Accoppiamento secondo ISO 286 (calcolato)",
  tr: "ISO 286'ya göre geçme (hesaplanmış)",
  pl: "Pasowanie wg ISO 286 (obliczone)",
  ru: "Посадка по ISO 286 (рассчитано)",
};

export const fitHeader = (language: Language): string => FIT_HEADER[language];

/** Translate the German system notices appended after the LLM message.
 *  Numbers, units, formulas and product names must survive verbatim. */
export async function localizeNotes(notesDe: string[], language: Language): Promise<string[]> {
  if (language === "de" || notesDe.length === 0) return notesDe;
  const SEP = "\n@@\n";
  try {
    const translated = await llmText([
      {
        role: "system",
        content:
          `Übersetze die folgenden Hinweise nach ${LANGUAGE_NAMES[language]}. ` +
          `Zahlen, Einheiten, Formelzeichen (Pe = Fc·vc/η), Emojis, Produkt- und Maschinennamen bleiben unverändert. ` +
          `Die Abschnitte sind durch "@@" getrennt — gib exakt ${notesDe.length} Abschnitte in derselben Reihenfolge und mit demselben Trenner zurück, ohne weiteren Text.`,
      },
      { role: "user", content: notesDe.join(SEP) },
    ]);
    const parts = translated.split(/\n?@@\n?/).map((s) => s.trim()).filter(Boolean);
    return parts.length === notesDe.length ? parts : notesDe;
  } catch (e: any) {
    if (clientAborted()) throw e;
    console.warn("[Notices] translation failed:", e.message);
    return notesDe;
  }
}
