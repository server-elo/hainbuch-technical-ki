# HAINBUCH Technical Advisor — Masterplan v2 („Als Käufer würde ich alles wollen")

Stand: 2026-07-05. Sortiert danach, was einen Käufer unterschreiben lässt:
**1. Vertrauen → 2. Abdeckung → 3. Arbeitsfluss → 4. Betrieb.**
Grundprinzip unverändert: das Modell liest und formuliert, der Code rechnet
und entscheidet — und jeder Richtwert kommt aus den eingelesenen Büchern,
nicht aus dem Modellgedächtnis.

## Bereits erledigt (Referenz)

Gauntlet (11 Fälle) · NC-Generator (Siemens/Fanuc/Heidenhain) · Kernloch-Solver
· PDF-Export · Feedback-Daumen · Produkt-DB 211 Produkte + Fotos · Kosten-
vergleich · Spannkraft-Ampel (kc aus Fachkunde Tab. 1, h-interpoliert) ·
Plan-Wiederverwendung bei Folgefragen · Maschinen-Recherche (max. Drehzahl)
· Sprachlogik per IP · Rate-Limit · 31 Unit-Tests.

---

## Sprint A — Buch-Kalibrierung der Schnittdaten (2–3 Tage) ⭐ höchster Vertrauensgewinn

Alle vc/f/fz/ap-Bereiche in `machining.ts` stammen bisher aus eigener Setzung.
Die Fachkunde liefert die echten Tabellen — jede Zahl wird zitierfähig.

1. Extraktion (JSON) aus Fachkunde-Flash:
   - Tab. „Vorbearbeitung Stahl (Längsdrehen)" + „Fertigbearbeitung Stahl"
   - Tab. „vc und fz für Fräser mit Hartmetallschneiden"
   - Tab. „Schnittwerte beschichtete HSS-Spiralbohrer" + „HSS-Gewindebohrer"
   - Korrekturtabelle „fz-Erhöhung beim Nutenfräsen nach Schnitttiefe"
2. `machining.ts`: MATERIALS-Bereiche aus diesen Tabellen speisen; Feld
   `source` je Bereich; die Arbeitsplan-Ausgabe zitiert („vc nach Fachkunde,
   Tab. Vorbearbeitung, Reihe C45").
3. Nutenfräs-Korrekturfaktor in calculateOperation anwenden.
4. **Abnahme:** die Rechenbeispiele der Fachkunde selbst als Unit-Tests
   (das Buch rechnet vor — wir müssen auf dieselben Zahlen kommen, wie beim
   16MnCr5-Beispiel schon geschehen). Gauntlet-Fall: Plan zitiert Quelle.

## Sprint B — Plausible Zeiten über Maschinenleistung (1–2 Tage)

Der Käufereinwand „4,35 min sind optimistisch" — jetzt buchkonform lösbar:
Fachkunde gibt Pe = Fc·vc/η. Wir kennen kc(h) je Material.

1. Maschinenleistung beschaffen wie die Drehzahl: Kunde fragt/nennt →
   sonst Gemini-Recherche zur genannten Maschine → sonst Annahme (z. B.
   15 kW, klar deklariert).
2. Q_max = P·η·60000/kc(h) im Code; Schruppzeiten, deren implizites Q
   darüber liegt, werden volumenkorrigiert (Mechanik existiert schon als
   removalVolume-Guard) — Hinweis nennt Formel + Quelle.
3. **Abnahme:** Gauntlet-Fall Stahlkonsole: Gesamtzeit ≥ Volumen-Untergrenze.

## Sprint C — Vier neue Solver aus den Büchern (2–3 Tage, parallelisierbar)

| Solver | Quelle (Fachkunde) | Nutzen |
|---|---|---|
| Schleifzeit | „Richtwerte zum Schleifen von Stahl/Guss" | schließt die ehrliche Lücke „Schleifen ohne Zeit" |
| Anziehdrehmomente | „Vorspannkräfte und Anziehdrehmomente Schaftschrauben" | Dauerbrenner-Frage, exakt lösbar |
| Allgemeintoleranzen | Toleranz-Tabellen (Geraden/Flächen/Winkel) | „was gilt ohne Toleranzangabe?" deterministisch |
| Wärmebehandlung | „Wärmebehandlungstemperaturen Vergütungs-/Einsatzstähle" | Härten/Anlassen-Fragen mit Zahlen |

Dazu: **Reibungszahlen-Tabelle** → µ im Spannkraft-Check mit Buchwert +
Zitat statt Annahme 0,25. **Gewindemaße-Tabelle** → Kernloch-Solver um
Flankendurchmesser/Gewindetiefe erweitern.
Muster ist immer gleich (kernloch_solver.py): Trigger-Regex → Tabellen-
Lookup → „FERTIGE LÖSUNG"-Block in rag_api. Je Solver 3–5 Unit-Tests +
1 Gauntlet-Fall.

## Sprint D — NC-Generator gegen das Buch validieren (1–2 Tage)

Die Fachkunde enthält komplette Beispielprogramme (Sinumerik 840D, PAL)
und die Parameterliste des Gewindedrehzyklus.

1. Unit-Tests: unsere Zyklen gegen die Buchprogramme (Syntax je Steuerung).
2. Gewindedrehzyklus (Drehteile) ergänzen — Parameter aus der Buchtabelle.
3. Einrichteblatt-Export (Werkzeugliste + Nullpunkt + Spannmittel als
   Abschnitt im PDF) — das Buch zeigt das Format vor.

## Sprint E — Zeichnung als erste Quelle (1–2 Wochen, größter Einzelhebel)

1. DXF/STEP-Parser (ezdxf in rag_api): exakte Maße/Toleranzen ohne Vision-
   Unsicherheit; Vision bleibt Fallback für Fotos.
2. Maß-Overlay im Chat: erkannte Maße auf der Zeichnung markiert,
   Ein-Klick-Bestätigung („stimmt das?").
3. Toleranz-Auslese (H7, Ra, Form/Lage) → fit_solver + Reiben/Schleifen-
   Entscheidung im Code (nutzt Sprint-C-Solver).

## Sprint F — Betrieb & Vertrieb erwachsen (2–3 Tage, braucht Lorenc-Entscheidungen)

1. Projekt von ~/Desktop → launchd-Autostart (Plist liegt bereit). *Entscheidung: Zielordner.*
2. Benannter Cloudflare-Tunnel + eigene Domain. *Entscheidung: Domainname.*
3. Chat-Verläufe serverseitig (SQLite) + Wiederaufnahme-Link.
4. Nächtlicher Gauntlet als Cron mit Mail/Push bei Rot.
5. Mini-Admin: feedback.jsonl + Tagesbudget + letzte Fragen auf einer Seite.
6. Angebots-Übergabe: Button „Anfrage an HAINBUCH senden" (PDF + Kontakt-
   daten per mailto/Formular) — der Advisor berät, der Mensch verkauft.

## Bewusst NICHT im Plan

- Preise/Angebotskalkulation (bleibt beim offiziellen Vertrieb)
- Fine-Tuning (System schlägt Gewichte)
- LLM-Rechenfreiheit (Richtung bleibt: mehr Code, weniger Modell)
- Richtwerte aus Modellwissen — nur noch Buch oder deklarierte Annahme

## Reihenfolge & Aufwand gesamt

**A (2–3 T) → B (1–2 T) → C (2–3 T) → D (1–2 T) → E (1–2 Wo) → F (2–3 T).**
A–D ≈ eine Woche konzentriert; danach ist jede Zahl im System entweder
berechnet, aus dem Katalog, aus der Fachkunde zitiert oder als Annahme
deklariert — das Verkaufsargument schlechthin.
