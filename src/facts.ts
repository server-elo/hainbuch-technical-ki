/** Rotating cards shown while the analysis runs — HAINBUCH product knowledge.
 *  One list per UI language; index 0 is always the time-savings teaser. */
import type { UiLang } from './i18n';

export interface Fact {
  tag: string;
  title: string;
  text: string;
}

const DE: Fact[] = [
  {
    tag: 'Zeitersparnis',
    title: 'Wussten Sie, wie viel Zeit Sie sparen?',
    text: 'Mit dem HAINBUCH Schnellwechsel-System sinkt Ihre Rüstzeit um bis zu 90 % — das Grundspannmittel bleibt auf der Spindel, Spannkopf, Backenmodul oder Dorn wechseln Sie in wenigen Minuten.',
  },
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
    title: 'Außen- & Innenspannung',
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

const EN: Fact[] = [
  {
    tag: 'Time savings',
    title: 'Did you know how much time you save?',
    text: 'With the HAINBUCH quick change-over system, set-up time drops by up to 90 % — the base clamping device stays on the spindle while you swap clamping head, jaw module or mandrel in minutes.',
  },
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

const ZH: Fact[] = [
  {
    tag: '节省时间',
    title: '您知道能节省多少时间吗？',
    text: '使用 HAINBUCH 快换系统，换装时间最多可减少 90 % — 基础夹具留在主轴上，夹头、卡爪模块或芯轴几分钟内即可更换。',
  },
  {
    tag: '精度',
    title: '跳动 ≤ 0.010 mm',
    text: 'TOPlus 和 SPANNTOP 卡盘的跳动精度可达 10 µm 或更高 — 对轴承位和紧密配合至关重要。',
  },
  {
    tag: '内涨夹持',
    title: 'MANDO 芯轴',
    text: '针对薄壁衬套和环件：MANDO 从内部夹持 — 变形小，重复精度极高。',
  },
  {
    tag: '换装时间',
    title: '几分钟内完成换装',
    text: '通过 HAINBUCH 适配系统，您可以在卡爪卡盘、夹头和芯轴之间切换 — 无需将基础夹具从主轴上拆下。',
  },
  {
    tag: '产品系列',
    title: '外夹与内涨',
    text: '外夹用 TOPlus 和 SPANNTOP，内涨用 MANDO 和 MAXXOS，固定式用 MANOK 和 TOROK — 每种应用都有合适的方案。',
  },
  {
    tag: '工艺可靠性',
    title: '夹紧力大、重量轻',
    text: '轻量化夹具减少换装工作量，并在完全工艺可靠的前提下允许更高转速。',
  },
  {
    tag: '自动化',
    title: '支持自动化',
    text: 'HAINBUCH 夹具专为自动上下料和机器人单元设计。',
  },
];

const ES: Fact[] = [
  {
    tag: 'Ahorro de tiempo',
    title: '¿Sabe cuánto tiempo puede ahorrar?',
    text: 'Con el sistema de cambio rápido HAINBUCH, el tiempo de preparación se reduce hasta un 90 % — el amarre base permanece en el husillo mientras cambia el cabezal, el módulo de garras o el mandrino en minutos.',
  },
  {
    tag: 'Precisión',
    title: 'Concentricidad ≤ 0,010 mm',
    text: 'Los platos TOPlus y SPANNTOP alcanzan una concentricidad de 10 µm o mejor — decisivo para asientos de rodamiento y ajustes estrechos.',
  },
  {
    tag: 'Amarre interior',
    title: 'Mandrinos MANDO',
    text: 'Para casquillos y anillos de pared delgada: MANDO amarra desde el interior — mínima deformación y máxima repetibilidad.',
  },
  {
    tag: 'Preparación',
    title: 'Cambio en minutos',
    text: 'Con el sistema de adaptación HAINBUCH cambia entre plato de garras, cabezal de amarre y mandrino — sin retirar el amarre base del husillo.',
  },
  {
    tag: 'Gama',
    title: 'Amarre exterior e interior',
    text: 'Amarre exterior con TOPlus y SPANNTOP, interior con MANDO y MAXXOS, estacionario con MANOK y TOROK — la solución adecuada para cada aplicación.',
  },
  {
    tag: 'Fiabilidad',
    title: 'Alta fuerza de amarre, poco peso',
    text: 'Los amarres ligeros reducen el esfuerzo de preparación y permiten mayores velocidades con total fiabilidad del proceso.',
  },
  {
    tag: 'Automatización',
    title: 'Listo para automatizar',
    text: 'Los amarres HAINBUCH están diseñados para carga automatizada y células robotizadas.',
  },
];

const FR: Fact[] = [
  {
    tag: 'Gain de temps',
    title: 'Savez-vous combien de temps vous économisez ?',
    text: 'Avec le système de changement rapide HAINBUCH, le temps de réglage diminue jusqu\'à 90 % — le moyen de serrage de base reste sur la broche, la tête de serrage, le module à mors ou le mandrin se changent en quelques minutes.',
  },
  {
    tag: 'Précision',
    title: 'Concentricité ≤ 0,010 mm',
    text: 'Les mandrins TOPlus et SPANNTOP atteignent une concentricité de 10 µm ou mieux — décisif pour les portées de roulement et les ajustements serrés.',
  },
  {
    tag: 'Serrage intérieur',
    title: 'Mandrins expansibles MANDO',
    text: 'Pour les douilles et bagues à paroi mince : MANDO serre de l\'intérieur — faible déformation, répétabilité maximale.',
  },
  {
    tag: 'Temps de réglage',
    title: 'Changement en quelques minutes',
    text: 'Avec le système d\'adaptation HAINBUCH, vous passez du mandrin à mors à la tête de serrage ou au mandrin expansible — sans retirer le moyen de serrage de base de la broche.',
  },
  {
    tag: 'Gamme',
    title: 'Serrage extérieur & intérieur',
    text: 'Serrage extérieur avec TOPlus et SPANNTOP, intérieur avec MANDO et MAXXOS, stationnaire avec MANOK et TOROK — la bonne solution pour chaque application.',
  },
  {
    tag: 'Fiabilité process',
    title: 'Force de serrage élevée, faible masse',
    text: 'Des moyens de serrage légers réduisent l\'effort de réglage et permettent des vitesses plus élevées en toute fiabilité.',
  },
  {
    tag: 'Automatisation',
    title: 'Prêt pour l\'automatisation',
    text: 'Les moyens de serrage HAINBUCH sont conçus pour le chargement automatisé et les cellules robotisées.',
  },
];

const IT: Fact[] = [
  {
    tag: 'Risparmio di tempo',
    title: 'Sa quanto tempo può risparmiare?',
    text: 'Con il sistema di cambio rapido HAINBUCH il tempo di attrezzaggio si riduce fino al 90 % — l\'attrezzatura base resta sul mandrino, testina di serraggio, modulo griffe o mandrino si cambiano in pochi minuti.',
  },
  {
    tag: 'Precisione',
    title: 'Concentricità ≤ 0,010 mm',
    text: 'Gli autocentranti TOPlus e SPANNTOP raggiungono una concentricità di 10 µm o migliore — decisiva per sedi cuscinetto e accoppiamenti stretti.',
  },
  {
    tag: 'Serraggio interno',
    title: 'Mandrini espandibili MANDO',
    text: 'Per boccole e anelli a parete sottile: MANDO serra dall\'interno — deformazione minima e massima ripetibilità.',
  },
  {
    tag: 'Attrezzaggio',
    title: 'Cambio in pochi minuti',
    text: 'Con il sistema di adattamento HAINBUCH si passa da autocentrante a testina di serraggio o mandrino — senza rimuovere l\'attrezzatura base dal mandrino macchina.',
  },
  {
    tag: 'Gamma',
    title: 'Serraggio esterno e interno',
    text: 'Serraggio esterno con TOPlus e SPANNTOP, interno con MANDO e MAXXOS, stazionario con MANOK e TOROK — la soluzione giusta per ogni applicazione.',
  },
  {
    tag: 'Affidabilità',
    title: 'Alta forza di serraggio, peso ridotto',
    text: 'Attrezzature leggere riducono l\'attrezzaggio e consentono regimi più alti con piena affidabilità di processo.',
  },
  {
    tag: 'Automazione',
    title: 'Pronto per l\'automazione',
    text: 'Le attrezzature di serraggio HAINBUCH sono progettate per carico automatizzato e celle robotizzate.',
  },
];

const TR: Fact[] = [
  {
    tag: 'Zaman tasarrufu',
    title: 'Ne kadar zaman kazandığınızı biliyor musunuz?',
    text: 'HAINBUCH hızlı değişim sistemi ile hazırlık süresi %90\'a kadar düşer — ana bağlama elemanı iş milinde kalır; sıkma kafası, çene modülü veya malafa birkaç dakikada değişir.',
  },
  {
    tag: 'Hassasiyet',
    title: 'Salgı ≤ 0,010 mm',
    text: 'TOPlus ve SPANNTOP aynalar 10 µm veya daha iyi salgı hassasiyetine ulaşır — rulman yatakları ve dar alıştırmalar için belirleyicidir.',
  },
  {
    tag: 'İçten bağlama',
    title: 'MANDO malafalar',
    text: 'İnce cidarlı burç ve halkalar için: MANDO içten bağlar — düşük deformasyon, en yüksek tekrarlanabilirlik.',
  },
  {
    tag: 'Hazırlık süresi',
    title: 'Dakikalar içinde değişim',
    text: 'HAINBUCH adaptasyon sistemi ile çeneli ayna, sıkma kafası ve malafa arasında geçiş yaparsınız — ana bağlama elemanını iş milinden sökmeden.',
  },
  {
    tag: 'Ürün gamı',
    title: 'Dıştan & içten bağlama',
    text: 'Dıştan bağlama TOPlus ve SPANNTOP ile, içten MANDO ve MAXXOS ile, sabit uygulamalar MANOK ve TOROK ile — her uygulama için doğru çözüm.',
  },
  {
    tag: 'Proses güvenliği',
    title: 'Yüksek bağlama kuvveti, düşük ağırlık',
    text: 'Hafif bağlama elemanları hazırlık işini azaltır ve tam proses güvenliğiyle daha yüksek devirlere izin verir.',
  },
  {
    tag: 'Otomasyon',
    title: 'Otomasyona hazır',
    text: 'HAINBUCH bağlama elemanları otomatik yükleme/boşaltma ve robot hücreleri için tasarlanmıştır.',
  },
];

export const FACTS_BY_LANG: Record<UiLang, Fact[]> = {
  de: DE,
  en: EN,
  zh: ZH,
  es: ES,
  fr: FR,
  it: IT,
  tr: TR,
};

// Backwards-compatible exports
export const HAINBUCH_FACTS = DE;
export const HAINBUCH_FACTS_EN = EN;
