/** Rotating cards shown while the analysis runs — HAINBUCH product knowledge. */

export interface Fact {
  tag: string;
  title: string;
  text: string;
}

export const HAINBUCH_FACTS_EN: Fact[] = [
  {
    tag: 'Precision',
    title: 'Run-out ≤ 0.010 mm',
    text: 'TOPlus and SPANNTOP chucks achieve a run-out accuracy of 10 µm or better — decisive for bearing seats and tight fits.',
  },
  {
    tag: 'I.D. clamping',
    title: 'MANDO mandrels',
    text: 'For thin-walled bushings and rings: MANDO clamps from the inside — low distortion, highest repeatability.',
  },
  {
    tag: 'Set-up time',
    title: 'Changeover in minutes',
    text: 'With the HAINBUCH adaptation system you switch between jaw module, clamping head and mandrel — without removing the base clamping device from the spindle.',
  },
  {
    tag: 'Range',
    title: 'O.D. & I.D. clamping',
    text: 'External clamping with TOPlus and SPANNTOP, internal with MANDO and MAXXOS, stationary with MANOK and TOROK — the right solution for every application.',
  },
  {
    tag: 'Process reliability',
    title: 'High clamping force, low weight',
    text: 'Lightweight clamping devices reduce set-up effort and allow higher speeds with full process reliability.',
  },
  {
    tag: 'Automation',
    title: 'Automation-ready',
    text: 'HAINBUCH clamping devices are designed for automated loading and robot cells.',
  },
];

export const HAINBUCH_FACTS: Fact[] = [
  {
    tag: 'Präzision',
    title: 'Rundlauf ≤ 0,010 mm',
    text: 'TOPlus und SPANNTOP Spannfutter erreichen eine Rundlaufgenauigkeit von 10 µm oder besser — entscheidend für Lagersitze und enge Passungen.',
  },
  {
    tag: 'Innenspannung',
    title: 'MANDO Spanndorne',
    text: 'Für dünnwandige Buchsen und Ringe: MANDO spannt von innen — verzugsarm und mit höchster Wiederholgenauigkeit.',
  },
  {
    tag: 'Rüstzeit',
    title: 'Umrüsten in Minuten',
    text: 'Mit dem HAINBUCH Adaptionssystem wechseln Sie zwischen Backenfutter, Spannkopf und Dorn — ohne das Grundspannmittel von der Spindel zu nehmen.',
  },
  {
    tag: 'Sortiment',
    title: 'O.D. & I.D. Spannung',
    text: 'Außenspannung mit TOPlus und SPANNTOP, Innenspannung mit MANDO und MAXXOS, stationär mit MANOK und TOROK — für jede Anwendung die passende Lösung.',
  },
  {
    tag: 'Prozesssicherheit',
    title: 'Hohe Spannkräfte, geringe Masse',
    text: 'Leichte Spannmittel reduzieren Rüstaufwand und erlauben höhere Drehzahlen bei voller Prozesssicherheit.',
  },
  {
    tag: 'Automation',
    title: 'Automationsfähig',
    text: 'HAINBUCH Spannmittel sind für automatisierte Be- und Entladung sowie Roboterzellen ausgelegt.',
  },
];
