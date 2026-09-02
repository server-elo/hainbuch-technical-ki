import { API_BASE } from './config';
import type { SetupSheetData } from './components/SetupSheetModal';

export function resolveImgUrl(url: string, alt?: string): string {
  if (!url) return url;
  // If url is not a real image (e.g. was generic domain), recover the exact hero image from alt text
  if (url.startsWith('https://www.hainbuch.com') || url.startsWith('http://www.hainbuch.com') || !/\.(jpg|jpeg|png|webp|svg)$/i.test(url)) {
    const a = (alt || '').toLowerCase();
    let hero = 'hero_94.jpg'; // default SPANNTOP nova
    if (a.includes('inoflex')) hero = 'hero_136.jpg';
    else if (a.includes('manok')) hero = 'hero_246.jpg';
    else if (a.includes('mando adapt')) hero = 'hero_272.jpg';
    else if (a.includes('mando')) hero = 'hero_178.jpg';
    else if (a.includes('toplus mini')) hero = 'hero_28.jpg';
    else if (a.includes('toplus')) hero = 'hero_60.jpg';
    else if (a.includes('centrotex')) hero = 'hero_242.jpg';
    else if (a.includes('b-top')) hero = 'hero_146.jpg';
    else if (a.includes('spanntop mini')) hero = 'hero_74.jpg';
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

  // Extract Drawing No
  const dwgMatch = text.match(/(?:Zeichnungs-?Nr\.?:?\s*|HT-)([A-Za-z0-9_-]+)/i);
  const drawingNo = dwgMatch ? (dwgMatch[0].startsWith('HT-') ? dwgMatch[0] : dwgMatch[1]) : 'HT-GW003 Rev. B';

  // Extract Material
  const matMatch = text.match(/(?:Werkstoff|Material):\s*([^\n,;]+)/i);
  const material = matMatch ? matMatch[1].trim() : 'Titan Grade 5 / 1.4301 / 16MnCr5';

  // Extract Quantity
  const qtyMatch = text.match(/(?:Losgröße|Menge|Stückzahl):\s*([0-9]+)/i);
  const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : 100;

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

  // Extract Clamping Info
  let mainSystem = 'HAINBUCH SPANNTOP / MANOK';
  if (/SPANNTOP/i.test(text)) mainSystem = 'SPANNTOP nova Kombi Axzug';
  else if (/TOPlus/i.test(text)) mainSystem = 'TOPlus mini Axzug';
  else if (/InoFlex/i.test(text)) mainSystem = 'InoFlex 4-Backenfutter';
  else if (/MANOK/i.test(text)) mainSystem = 'MANOK plus Stationärspanner';

  let colletOrJaw = 'Spannkopf glatt';
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
    tools.push(
      { slot: 'T01', type: 'Schruppdrehmeißel / Plan', insert: 'WNMG 080408-SM', vc: '220', n: '1550', vf: '388' },
      { slot: 'T02', type: 'Schlichtdrehmeißel Kontur', insert: 'CCMT 09T304-PF', vc: '260', n: '1800', vf: '220' },
      { slot: 'T03', type: 'VHM-Bohrer mit IKZ', insert: 'VHM AlTiN (IKZ)', vc: '90', n: '1450', vf: '260' },
      { slot: 'T04', type: 'VHM-Maschinenreibahle', insert: 'VHM Feinstkorn', vc: '32', n: '450', vf: '105' }
    );
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

      const matMatch = clean.match(/\b(8[0-9]{4})\b/);
      const matNr = matMatch ? matMatch[1] : `HB-${posCounter * 100 + 42}`;

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
    bom.push(
      { pos: 1, matNr: 'HB-10042', name: mainSystem, category: 'Hauptspannmittel', qty: 1 },
      { pos: 2, matNr: '80047', name: colletOrJaw, category: 'Spannelement', qty: 1 },
      { pos: 3, matNr: '80052', name: 'vario flex Werkstückanschlag', category: 'Werkstückanschlag', qty: 1 },
      { pos: 4, matNr: '83923', name: 'Manuelle Wechselvorrichtung', category: 'Zubehör', qty: 1 }
    );
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
      pressureBar: '18 bar',
      forceKn: '35 kN',
      maxRpm: '4.500 1/min',
    },
    tools,
    bom,
  };
}
