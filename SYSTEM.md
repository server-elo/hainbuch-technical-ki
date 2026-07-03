# HAINBUCH Technical Advisor — Systemübersicht

Stand: 2026-07-03. Lokale RAG-Anwendung für Fertigungsberatung: Werkstoffwahl,
Arbeitsplan mit berechneten Zeiten, Passungsanalyse, Spannmittel-Empfehlung.

## Architektur — das Grundprinzip

**Das Modell liest und formuliert. Der Code rechnet und entscheidet.**
Jede Zahl, die falsch sein könnte, kommt aus deterministischem Code:

| Rechner | Was er garantiert |
|---|---|
| `machining.ts` | n, vf, Hauptzeit nach ISO-Formeln; vc/f an Richtwerte geklemmt; DIN-13-Gewindesteigungen M3–M42; Maschinen-Drehzahllimit |
| `fit_solver.py` | Passungen ISO 286 (H7/G7/M7 × h6–r6): Grenzmaße, P_SH, P_ÜH |
| `solved_it_block` | IT-Grundtoleranzen (Band-Lookup) |
| `solved_cutting_block` | Schnittdaten-Ketten inkl. rpm-Limit |
| `product_db.py` | 145 Katalogprodukte mit exakten Daten (Spannbereich, Drehzahl, Mat.-Nr., Seite) |
| `normalizeRawStock` | Rohmaß = Fertigmaß + Aufmaß, Normgrößen |
| `verifyDimensions` | Zeichnungs-Maßketten müssen rechnerisch aufgehen |

## Pipeline (server.ts)

1. **Intent-Routing**: Smalltalk (~10 s) / Fachfrage (~25 s, RAG-gestützt) /
   Fertigungsauftrag (voller Ablauf). 9 Sprachen erkannt — Suche immer auf
   Deutsch (Sprache der Wissensbasis), Antwort in Kundensprache.
2. **Rückfragen zuerst**: fehlen Werkstoff/Stückzahl/Maße, fragt der Advisor
   einmal nach (Prioritätsreihenfolge), bevor er plant.
3. **Zeichnungsanalyse**: Kachelung + Maß-Extraktion + Maßketten-Verifikation;
   partType-Guard (prismatisch → kein Drehen, stationäre Spannmittel).
4. **Werkstoff** (RAG: Fachkunde + Tabellenbuch) → **Arbeitsplan + Spannmittel**
   (RAG: Katalog DE→EN) → **Zeitberechnung im Code**.
5. Streaming-Events → Fortschrittsbalken (aufklappbar) + Thinking-Indikator.

## Wissensbasis (Engineering-RAG, Qdrant + BGE-M3 hybrid)

| Kollektion | Inhalt | Qualität |
|---|---|---|
| hainbuch_katalog_de | Katalog 2026, 632 Seiten, Textebene | **99,5 % verifiziert**, Seitenmetadaten |
| hainbuch_lift_de | Vision-OCR: Bild-Beschreibungen + Grafikseiten | 85,5 % (Ergänzung) |
| fachkunde_metall / fachkunde_lift | Fachkunde Metall, 625 Seiten, doppelt | gut / vollständig |
| tabellenbuch_metall | ISO 286 generiert (nach Bugfix korrekt) | exakt |
| techniker_zeichnungen, uhren_cnc | kuratiert | klein |
| Rescan läuft: Fachkunde + Techn. Zeichnen mit Gemini Flash | ersetzt fehlerbehaftete Altversionen | — |

`rag_api.py` (Port 7777) injiziert die deterministischen Lösungsblöcke in
jede Suche. `audit_page_coverage.py` beweist Auffindbarkeit pro Seite.

## Messwerte (alle live getestet)

- Fachkunde-Prüfungsfragen: 3/3 exakt; 10er-Gauntlet: 35/36 Checks
- Passung ∅22 H7/g6 e2e: P_SH 0,041 exakt, immer (Code-Anhang an Antwort)
- Zeichnung (96×65×64-Konsole): 23 Maße gelesen, 10 Ketten bestätigt,
  korrekter Fräsplan ohne Drehen, MANOK-Empfehlung
- Vision-OCR Katalog: 632/632 Seiten, 0 Fehler, 16 min (Gemini Flash, 4 Worker)
- Unit-Tests Rechenkern: `npm test` → 7/7

## Betrieb

- Start: `bash start.sh` (prüft LLM-Endpoint, startet Wissensdatenbank + Web)
- Web: http://localhost:3000 · Health: /health
- LLM: beliebiger OpenAI-kompatibler Endpoint (.env). Getestet: LM Studio
  (Qwen3-VL lokal) und VibeProxy (Gemini 3.1 Pro — schneller & bessere Vision).
- launchd-Autostart scheitert an macOS-TCC solange das Projekt auf dem
  Desktop liegt (Plist liegt bereit: com.lorenc.hainbuch-rag).

## Bekannte Grenzen (ehrlich)

- Schruppzeiten optimistisch: Schnittweg×Durchgänge schätzt das Modell;
  Volumen-Plausibilisierung (Q = ap·ae·vf) ist der nächste Rechner.
- Zeichnungslesen braucht ≥2000 px Quelle oder CAD-PDF/DXF für Maßtreue.
- Schleifen/Erodieren/Schweißen: nur Fachwissen, keine Zeitberechnung.
- Preise bewusst entfernt — nur über offizielles Angebot.
