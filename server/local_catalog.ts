/**
 * Local catalogue grounding when Engineering-RAG (:7777) is unavailable.
 * Uses website scrape JSON + products_de excerpts shipped in the repo.
 */
import fs from "fs";
import path from "path";

type WebProduct = {
  name?: string;
  display_name?: string;
  claim?: string;
  meta_description?: string;
  features?: string[];
  type?: string;
};

type CatalogProduct = {
  name: string;
  page?: number;
  matnr?: string[];
  excerpt?: string;
  fields?: Record<string, string>;
};

let webProducts: WebProduct[] | null = null;
let catalogProducts: CatalogProduct[] | null = null;

function loadWeb(): WebProduct[] {
  if (webProducts) return webProducts;
  const p = path.join(process.cwd(), "data/hainbuch-website/hainbuch_products.json");
  try {
    webProducts = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    webProducts = [];
  }
  return webProducts!;
}

function loadCatalog(): CatalogProduct[] {
  if (catalogProducts) return catalogProducts;
  const p = path.join(process.cwd(), "assets/products/products_de.json");
  try {
    catalogProducts = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    catalogProducts = [];
  }
  return catalogProducts!;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

const PRODUCT_FAMILIES: { re: RegExp; label: string }[] = [
  { re: /toplus/, label: "TOPlus" },
  { re: /spanntop/, label: "SPANNTOP" },
  { re: /hydrok/, label: "HYDROK" },
  { re: /manok/, label: "MANOK" },
  { re: /maxxos/, label: "MAXXOS" },
  { re: /centrotex/, label: "Centrotex" },
];

/** Build a grounded context block for product questions (esp. TESTit). */
export function localProductContext(query: string): string {
  const n = norm(query);
  const wantsTestit =
    /testit|test\s*it|spannkraftmess|messgerat|messtechnik|pruf.*mess|einzugskraft/.test(n) ||
    (/test\s*modul/.test(n) && /spann|mess|einzug/.test(n));
  const family = PRODUCT_FAMILIES.find((f) => f.re.test(n)) || null;

  // No product intent → no local catalogue dump.
  if (!wantsTestit && !family && !/hainbuch/.test(n)) return "";

  const parts: string[] = [];

  if (wantsTestit) {
    const web = loadWeb().filter((p) => /testit/i.test(`${p.name || ""} ${p.display_name || ""}`));
    for (const p of web.slice(0, 2)) {
      const title = p.display_name || p.name || "TESTit";
      parts.push(
        `### [HAINBUCH-Katalog / Website] ${title}\n` +
          `${p.claim || ""}\n${p.meta_description || ""}\n` +
          (p.features?.length ? `Merkmale:\n- ${p.features.join("\n- ")}\n` : "")
      );
    }
    // TEST modules from catalogue OCR
    const mods = loadCatalog().filter((p) => /^TEST\b/i.test(p.name) || /IT Modul/i.test(p.name));
    for (const m of mods.slice(0, 6)) {
      const excerpt = (m.excerpt || "").replace(/\s+/g, " ").slice(0, 500);
      parts.push(
        `### [HAINBUCH-Katalog] ${m.name}\n` +
          (m.matnr?.length ? `Material-Nr.: ${m.matnr.slice(0, 8).join(", ")}\n` : "") +
          `${excerpt}\n`
      );
    }
    if (parts.length) {
      parts.unshift(
        `## LOKALER KATALOG-KONTEXT (TESTit / Prüf- und Messtechnik)\n` +
          `TESTit ist das HAINBUCH-**Spannkraftmessgerät** / Messsystem für Spannkraft und Einzugskraft ` +
          `(Außen- und Innenspannung, HSK-Einzugskraft, auch unter Drehzahl). System: IT-Modul + passende TEST-Module; ` +
          `App zur Visualisierung und Archivierung.\n`
      );
    }
  }

  // Bugfix: family names matched the early gate but never populated parts
  // (TOPLUS/SPANNTOP/HYDROK/… always returned ""). Ground from local JSON.
  if (family && !wantsTestit) {
    const famRe = family.re;
    const webHits = loadWeb().filter((p) =>
      famRe.test(norm(`${p.name || ""} ${p.display_name || ""} ${p.type || ""}`))
    );
    for (const p of webHits.slice(0, 3)) {
      const title = p.display_name || p.name || family.label;
      parts.push(
        `### [HAINBUCH-Katalog / Website] ${title}\n` +
          `${p.claim || ""}\n${p.meta_description || ""}\n` +
          (p.features?.length ? `Merkmale:\n- ${p.features.slice(0, 8).join("\n- ")}\n` : "")
      );
    }
    const catHits = loadCatalog().filter((p) => famRe.test(norm(p.name || "")));
    for (const m of catHits.slice(0, 4)) {
      const excerpt = (m.excerpt || "").replace(/\s+/g, " ").slice(0, 500);
      parts.push(
        `### [HAINBUCH-Katalog] ${m.name}\n` +
          (m.matnr?.length ? `Material-Nr.: ${m.matnr.slice(0, 8).join(", ")}\n` : "") +
          `${excerpt}\n`
      );
    }
    if (parts.length) {
      parts.unshift(
        `## LOKALER KATALOG-KONTEXT (${family.label})\n` +
          `Auszüge aus dem lokalen HAINBUCH-Katalog / Website-Dump zu **${family.label}**. ` +
          `Zahlen und Bezeichnungen nur aus den folgenden Blöcken übernehmen.\n`
      );
    }
  }

  return parts.join("\n");
}
