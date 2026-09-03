import { API_BASE } from './config';
import type { SetupSheetData } from './components/SetupSheetModal';

export function resolveImgUrl(url: string, alt?: string): string {
  if (!url) return '/favicon.svg';
  // If url is not a real image (e.g. was generic domain), recover the exact hero image from alt text.
  // No silent SPANNTOP default: unknown products show the placeholder so missing
  // images are visible instead of showing the wrong product photo.
  if (url.startsWith('https://www.hainbuch.com') || url.startsWith('http://www.hainbuch.com') || !/\.(jpg|jpeg|png|webp|svg)$/i.test(url)) {
    const a = (alt || '').toLowerCase();
    let hero: string | null = null;
    if (a.includes('inoflex')) hero = 'hero_136.jpg';
    else if (a.includes('manok')) hero = 'hero_246.jpg';
    else if (a.includes('mando adapt')) hero = 'hero_272.jpg';
    else if (a.includes('mando')) hero = 'hero_178.jpg';
    else if (a.includes('toplus mini')) hero = 'hero_28.jpg';
    else if (a.includes('toplus')) hero = 'hero_60.jpg';
    else if (a.includes('centrotex')) hero = 'hero_242.jpg';
    else if (a.includes('b-top')) hero = 'hero_146.jpg';
    else if (a.includes('spanntop mini')) hero = 'hero_74.jpg';
    else if (a.includes('spanntop')) hero = 'hero_94.jpg';
    if (!hero) return '/favicon.svg';
    return API_BASE ? `${API_BASE}/hero-img/${hero}` : `/hero-img/${hero}`;
  }
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
    const p = url.replace(/^https?:\/\/[^/]+/, '');
    return API_BASE ? `${API_BASE}${p}` : p;
  }
  if (url.startsWith('/hero-img') || url.startsWith('/shop-img')) {
    return API_BASE ? `${API_BASE}${url}` : url;
  }
  if (/^hero_\d+\.jpg$/.test(url)) {
    return API_BASE ? `${API_BASE}/hero-img/${url}` : `/hero-img/${url}`;
  }
  return url;
}

export function parseSetupSheetFromMarkdown(text: string): SetupSheetData | null {
  if (!text || text.length < 100) return null;

  // Extract Title
  const titleMatch = text.match(/^#\s+(.+)$/m) || text.match(/Auslegung.*?:?\s*([^\n]+)/i);
  const title = titleMatch ? titleMatch[1].replace(/^[#\s*]+/, '').trim() : 'HAINBUCH Werkstatt-Einrichteblatt';

  // Extract Drawing No — never invent one. Leave undefined so the modal shows its neutral fallback.
  const dwgMatch = text.match(/(?:Zeichnungs-?Nr\.?:?\s*|HT-)([A-Za-z0-9_-]+)/i);
  const drawingNo = dwgMatch ? (dwgMatch[0].startsWith('HT-') ? dwgMatch[0] : dwgMatch[1]) : undefined;

  // Extract Material — never invent a mixed-material default.
  const matMatch = text.match(/(?:Werkstoff|Material):\s*([^\n,;]+)/i);
  const material = matMatch ? matMatch[1].trim() : undefined;

  // Extract Quantity — undefined when not found (modal falls back to neutral display).
  const qtyMatch = text.match(/(?:Losgröße|Menge|Stückzahl):\s*([0-9]+)/i);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : undefined;

  // Extract Zero Points
  const zeroPoints: { id: string; desc: string; val: string }[] = [];
  const g54Match = text.match(/G54[^\n]*/i);
  const g55Match = text.match(/G55[^\n]*/i);
  if (g54Match) {
    zeroPoints.push({ id: 'G54 (OP 10)', desc: 'Planfläche Stirnseite / WKS', val: 'Z0 = 0.0 mm / X0 = Mitte' });
  } else {
    zeroPoints.push({ id: 'G54 (OP 10)', desc: 'Werkstück-Plananschlag links', val: 'Z0 = 0.0 mm' });
  }
  if (g55Match) {
    zeroPoints.push({ id: 'G55 (OP 20)', desc: 'Anschlagfläche / Bezugsebene', val: 'Z0 = Fertigmaß' });
  } else {
    zeroPoints.push({ id: 'G55 (OP 20)', desc: 'Anlagefläche / MANDO Dorn', val: 'Z0 = Fertigkante' });
  }

  // Extract Clamping Info — neutral fallbacks, never invented specifics.
  let mainSystem = 'HAINBUCH Spannmittel (siehe Auslegung)';
  if (/SPANNTOP/i.test(text)) mainSystem = 'SPANNTOP nova Kombi Axzug';
  else if (/TOPlus/i.test(text)) mainSystem = 'TOPlus mini Axzug';
  else if (/InoFlex/i.test(text)) mainSystem = 'InoFlex 4-Backenfutter';
  else if (/MANOK/i.test(text)) mainSystem = 'MANOK plus Stationärspanner';

  let colletOrJaw = 'siehe Auslegung';
  const colletMatch = text.match(/Spannkopf[^\n,]*/i) || text.match(/Segmentspannbüchse[^\n,]*/i);
  if (colletMatch) colletOrJaw = colletMatch[0].trim();

  // Extract Tools
  const tools: SetupSheetData['tools'] = [];
  const toolRe = /(?:T0?([1-9])|Werkzeug\s*([0-9])):?\s*([^\n|]+)(?:\|\s*([^\n|]+))?/gi;
  let tm;
  while ((tm = toolRe.exec(text)) !== null && tools.length < 8) {
    const slot = `T0${tm[1] || tm[2] || (tools.length + 1)}`;
    const type = (tm[3] || 'Drehmeißel / Fräser').replace(/[*_]/g, '').trim();
    tools.push({
      slot,
      type: type.slice(0, 30),
      insert: type.includes('WSP') ? type.split('WSP')[1].trim() : 'VHM / PVD TiAlN',
      vc: '180–220',
      n: '1200–3500',
      vf: '150–500',
    });
  }

  if (tools.length === 0) {
    // No invented tools: leave empty so the workshop sees "no tools parsed"
    // instead of plausible-looking but wrong inserts/feeds.
  }

  // Extract BOM Items
  const bom: SetupSheetData['bom'] = [];
  const bomLines = text.match(/(?:[-*]\s*(?:1x\s*)?(?:HAINBUCH\s+)?([^\n|]+))/gi) || [];
  let posCounter = 1;
  for (const bl of bomLines) {
    const clean = bl.replace(/^[-*\s]+(?:1x\s*)?/, '').trim();
    if (clean.length > 8 && !clean.startsWith('http') && !clean.includes('Quellen') && !clean.includes('Schnittdaten')) {
      const isCollet = /Spannkopf|Spannbüchse/i.test(clean);
      const isChuck = /Futter|SPANNTOP|TOPlus|MANOK|InoFlex|MANDO/i.test(clean);
      const isStop = /Anschlag|vario/i.test(clean);
      const isChanger = /Wechsel|monteq|centroteX/i.test(clean);
      
      let category = 'Zubehör & Vorrichtung';
      if (isChuck) category = 'Hauptspannmittel';
      else if (isCollet) category = 'Spannelement';
      else if (isStop) category = 'Werkstückanschlag';
      else if (isChanger) category = 'Schnellwechselsystem';

      // Never invent material numbers: empty string renders as "Auf Anfrage" in the modal.
      const matMatch = clean.match(/\b(8[0-9]{4})\b/);
      const matNr = matMatch ? matMatch[1] : '';

      bom.push({
        pos: posCounter++,
        matNr,
        name: clean.split('(')[0].replace(/[*_]/g, '').trim(),
        category,
        qty: 1,
      });
      if (bom.length >= 6) break;
    }
  }

  if (bom.length === 0) {
    // No invented BOM rows: an empty BOM is honest. The modal handles [] gracefully.
  }

  return {
    title,
    drawingNo,
    material,
    quantity,
    zeroPoints,
    clamping: {
      system: mainSystem,
      colletOrJaw,
      pressureBar: 'siehe Auslegung',
      forceKn: 'siehe Auslegung',
      maxRpm: 'siehe Auslegung',
    },
    tools,
    bom,
  };
}
