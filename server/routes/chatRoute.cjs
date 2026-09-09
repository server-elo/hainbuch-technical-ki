// Chat route handler (/api/chat) with SSE streaming, fast-path smalltalk, vision transcript & 2-pass QA
const { BASE_URL, MODEL_ID, MODEL_QA } = require("../config.cjs");
const {
  llmFetch,
  cleanLaTeX,
  redactMessages,
  logChatInteraction,
} = require("../services/llmService.cjs");
const {
  buildKbContext,
  retrieveShop,
  getHeroForProduct,
} = require("../services/catalogService.cjs");
const {
  retrieveCatalog,
  retrieveGoldStandards,
} = require("../services/goldStandardService.cjs");
const {
  precomputeFits,
  verifyFitNumbers,
} = require("../services/fitsService.cjs");
const {
  clientIp,
  hashIp,
} = require("../middleware/rateLimiter.cjs");
const {
  UI_LANG_MAP,
  getStatusLabel,
  SYSTEM_PROMPT_BODY,
} = require("../prompts/systemPrompt.cjs");
const { RAW_PROMPT } = require("../prompts/rawPrompt.cjs");
const { buildQaSystemPrompt } = require("../prompts/qaChecklist.cjs");
const { firebaseMode } = require("./authRoute.cjs");

let histDb = null;
let histAuth = null;
try { histDb = require("../../lib/db.cjs"); } catch {}
try { histAuth = require("../../lib/auth.cjs"); } catch {}

function emit(res, obj) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(JSON.stringify(obj) + "\n");
  } catch { /* client gone */ }
}

async function persistChatTurn(req, parsed, questionText, cleaned, durationMs, model) {
  try {
    if (!histDb || !histDb.ok()) return null;
    const auth = histAuth ? await histAuth.getAuth(req).catch(() => null) : null;
    const claimed = (parsed && parsed.email) || req.headers["x-user-email"];
    const email = histDb.normalizeEmail((auth && auth.email) || (!firebaseMode() ? claimed : ""));
    let userId = (auth && auth.uid) || "";
    let user = userId ? histDb.getUserById(userId) : null;
    if (!user && email) user = histDb.getUserByEmail(email) || histDb.upsertUser({ email });
    if (!user && !email) return null;
    if (user) userId = user.id;
    const uiLang = String((parsed && parsed.uiLang) || req.headers["x-ui-lang"] || "").slice(0, 8);
    const country = String((parsed && parsed.country) || req.headers["cf-ipcountry"] || "").slice(0, 4);
    let convId = parsed && parsed.conversationId;
    if (convId) {
      const c = histDb.getConversation(convId, userId);
      if (!c) convId = null;
    }
    if (!convId) {
      const conv = histDb.createConversation({
        userId,
        title: String(questionText || "Beratung").slice(0, 120) || "Beratung",
        country,
        uiLang,
        machine: parsed && parsed.machine,
      });
      convId = conv && conv.id;
    }
    if (!convId) return null;
    histDb.addMessage({ conversationId: convId, role: "user", content: questionText });
    histDb.addMessage({ conversationId: convId, role: "assistant", content: cleaned, model: model || MODEL_ID, durationMs });
    return convId;
  } catch (e) {
    console.warn("[history] persist failed:", e.message);
    return null;
  }
}

function catalogText(p) {
  const f = p.fields || {};
  return Object.entries(f)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
}

async function handleChat(req, res) {
  let body = "";
  let tooLarge = false;

  req.on("data", (c) => {
    if (tooLarge) return;
    body += c;
    if (body.length > 15 * 1024 * 1024) {
      tooLarge = true;
      try { res.writeHead(413, { "Content-Type": "application/json" }); } catch {}
      try { res.end(JSON.stringify({ error: "payload too large" })); } catch {}
      try { req.destroy(); } catch {}
    }
  });

  req.on("end", async () => {
    if (tooLarge) return;
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    let messages;
    let parsed;
    try {
      parsed = JSON.parse(body);
      if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) throw new Error();
      messages = parsed.messages.slice(-20).map((m) => {
        const role = m.role === "model" ? "assistant" : m.role === "system" ? "user" : m.role;
        if (Array.isArray(m.parts)) {
          const text = m.parts
            .map((p) => p.text || "")
            .filter(Boolean)
            .join("\n")
            .slice(0, 20000);
          const images = m.parts
            .filter((p) => p.inlineData && String(p.inlineData.mimeType || "").startsWith("image/"))
            .slice(0, 4)
            .map((p) => ({
              type: "image_url",
              image_url: { url: `data:${p.inlineData.mimeType};base64,${String(p.inlineData.data || "").slice(0, 5 * 1024 * 1024)}` },
            }));
          if (images.length) {
            return { role, content: [{ type: "text", text: text || "Bitte analysiere das angehängte Bild." }, ...images] };
          }
          return { role, content: text };
        }
        return { role, content: String(m.content ?? "").slice(0, 20000) };
      }).filter((m) => (typeof m.content === "string" ? m.content : m.content.length));
    } catch {
      res.write(JSON.stringify({ error: "messages missing" }) + "\n");
      return res.end();
    }

    const rawLang = String((parsed && parsed.uiLang) || req.headers["x-ui-lang"] || "de").toLowerCase().slice(0, 8);
    const uiLang = UI_LANG_MAP[rawLang]
      ? rawLang
      : rawLang.startsWith("en")
        ? "en"
        : rawLang.startsWith("zh")
          ? "zh"
          : rawLang.startsWith("es")
            ? "es"
            : rawLang.startsWith("fr")
              ? "fr"
              : rawLang.startsWith("it")
                ? "it"
                : rawLang.startsWith("tr")
                  ? "tr"
                  : "de";
    const langInfo = UI_LANG_MAP[uiLang] || UI_LANG_MAP.de;

    const lastQuestion = [...messages].reverse().find((m) => m.role === "user");
    const questionText =
      typeof lastQuestion?.content === "string"
        ? lastQuestion.content
        : Array.isArray(lastQuestion?.content)
          ? lastQuestion.content.filter((c) => c.type === "text").map((c) => c.text).join(" ")
          : "";

    const allMessagesText = messages
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content.filter((c) => c.type === "text").map((c) => c.text).join(" ")
            : ""
      )
      .join(" ");

    const combinedQuery = `${questionText} ${allMessagesText}`.trim();
    const context = buildKbContext(combinedQuery);
    const shopHits = retrieveShop(combinedQuery);
    let shopContext = "";
    if (shopHits.length) {
      const lines = shopHits.map(
        (p) =>
          `- ${p.title} | Mat-Nr: ${p.materialNo || "—"} | Größe: ${p.size || "—"}${p.clampDiaMm ? " | Spann-Ø: " + p.clampDiaMm + " mm" : ""}${p.fits ? " | Passend für: " + p.fits.replace(/\n/g, ", ") : ""}${p.image ? ` | Foto: ![${p.title}](${BASE_URL}/shop-img/${p.image})` : ""}`
      );
      shopContext = `\n\nKONKRETE HAINBUCH-SHOP-PRODUKTE MIT MAT-NUMMERN & FOTO ZU DIESER ANFRAGE (übernimm diese realen Artikelnummern in Stücklisten und Einrichteblatt):\n${lines.join("\n")}`;
    }

    const catalogHits = retrieveCatalog(combinedQuery);
    const precomputed = precomputeFits(combinedQuery);
    let fitsContext = precomputed;
    let catalogContext = "";
    if (catalogHits.length) {
      const lines = catalogHits.map((p) => {
        const hero = getHeroForProduct(p.name);
        const img = hero ? ` | Foto: ![${p.name}](${BASE_URL}/hero-img/${hero})` : "";
        return `- ${p.name}${p.fields ? " | Technische Daten: " + catalogText(p) : ""} | Materialnummern: ${(p.matnr || []).join(", ") || "—"}${img}`;
      });
      catalogContext = `\n\nHAINBUCH-KATALOG-PRODUKTE MIT OFFIZIELLEN TECHNISCHEN DATEN (maßgeblich – diese Werte in Tabellen übernehmen; Fotos direkt einbinden):\n${lines.join("\n")}`;
    }

    const machine = parsed?.machine;
    let machineContext = "";
    if (machine && machine.name) {
      machineContext = `\n\nKUNDEN-MASCHINENPROFIL:\n- Ausgewählte Maschine: ${machine.name}\n- Spindelschnittstelle: ${machine.spindle || "Standard"}\n- CNC-Steuerung & G-Code Format: ${machine.control || "Siemens Sinumerik / ISO"}\n${machine.drawtube ? "- Zugrohranbindung: " + machine.drawtube + "\n" : ""}${machine.table ? "- Maschinentisch: " + machine.table + "\n" : ""}WICHTIG: Nutze diese Spindelschnittstelle für die Flansch- und Einrichteblatt-Auslegung und formatiere eventuelle CNC-Programm-Zyklen exakt für die angegebene Steuerung (${machine.control || "Siemens / ISO"})!\n`;
    }

    const goldContext = retrieveGoldStandards(combinedQuery);
    const prevPlan = parsed?.lastAnalysis;
    let followupContext = "";
    if (prevPlan && typeof prevPlan === "object") {
      try {
        const s = JSON.stringify(prevPlan).slice(0, 2000);
        if (s.length > 20) followupContext = `\n\nVORHERIGER ARBEITSPLAN (Folgefrage bezieht sich ggf. darauf):\n${s}`;
      } catch {}
    }

    const startTime = Date.now();
    const heartbeat = setInterval(() => emit(res, { type: "ping" }), 15000);

    const aborter = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) aborter.abort();
    });
    const llmSignal = () => AbortSignal.any([AbortSignal.timeout(600000), aborter.signal]);

    const hasImagesEarly = messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"));

    // Fast-path for smalltalk ("Hey", "Danke", ...)
    const isSmalltalk = (() => {
      if (hasImagesEarly) return false;
      const q = (questionText || "").trim();
      if (!q || q.length > 40) return false;
      if (/\d/.test(q)) return false;
      if (/[Øø]|\bmm\b|\bµm\b|\bISO\b|\bH7\b|\bh6\b|\bk6\b|spann|futter|mando|toplus|manok|inoflex|centrotex|dreh|fräs|bohr|reib|werkst|passung|schnitt|maschine/i.test(q)) return false;
      return /^(hi|hey|hello|hallo|guten\s*(tag|morgen|abend)?|moin|servus|grüezi|danke|thanks?|bitte|ok|okay|ja|nein|tschüss|bye|ciao)\b[.!?\s]*$/i.test(q);
    })();

    try {
      if (isSmalltalk) {
        emit(res, { type: "status", stage: "chat", label: getStatusLabel("moment", uiLang) });
        const smalltalkSys = uiLang === "de"
          ? "Du bist der HAINBUCH Technical Advisor. Antworte kurz und freundlich auf Deutsch (1-2 Sätze): begrüße, stelle dich als Spanntechnik-Berater vor und bitte um Werkstückdaten / Zeichnung / Toleranzen. Keine Arbeitspläne, keine Tabellen, keine Quellen."
          : `You are the HAINBUCH Technical Advisor. Respond briefly and kindly in ${langInfo.name} (1-2 sentences): greet the user, introduce yourself as the HAINBUCH clamping technology advisor, and invite them to describe their workpiece or upload a technical drawing/tolerances. You MUST write strictly and exclusively in ${langInfo.name}. No operation plans, no tables, no sources.`;

        const { res: sj, model: fastModel } = await llmFetch({
          model: MODEL_ID,
          messages: [
            { role: "system", content: smalltalkSys },
            ...messages.slice(-4),
          ],
        }, llmSignal(), "fast");

        const defaultWelcome = uiLang === "de"
          ? "Hallo! Ich bin der HAINBUCH Technical Advisor für Spanntechnik. Beschreiben Sie gern Ihr Werkstück oder laden Sie eine Zeichnung hoch!"
          : uiLang === "en"
            ? "Hello! I am the HAINBUCH Technical Advisor for clamping technology. Feel free to describe your workpiece or upload a technical drawing!"
            : uiLang === "es"
              ? "¡Hola! Soy el HAINBUCH Technical Advisor para técnica de sujeción. ¡Describa su pieza o suba un plano técnico!"
              : uiLang === "fr"
                ? "Bonjour ! Je suis le HAINBUCH Technical Advisor pour la technique de serrage. N'hésitez pas à décrire votre pièce ou à importer un plan technique !"
                : uiLang === "it"
                  ? "Buongiorno! Sono l'HAINBUCH Technical Advisor per la tecnologia di bloccaggio. Descriva pure il Suo pezzo o carichi un disegno tecnico!"
                  : uiLang === "tr"
                    ? "Merhaba! Bağlama teknolojisi için HAINBUCH Technical Advisor'ım. Lütfen parçanızı tarif edin veya teknik resim yükleyin!"
                    : "您好！我是 HAINBUCH 夹紧技术顾问。请描述您的工件或上传技术图纸！";

        const sText = cleanLaTeX(sj.choices?.[0]?.message?.content ?? defaultWelcome, BASE_URL);
        logChatInteraction({
          ipHash: hashIp(clientIp(req)),
          country: req.headers["cf-ipcountry"] || null,
          messages: redactMessages(messages),
          question: questionText,
          response: sText,
          imagesCited: [],
          durationMs: Date.now() - startTime,
          stage: "success",
          fastPath: true,
        });
        const convIdFast = await persistChatTurn(req, parsed, questionText, sText, Date.now() - startTime, fastModel);
        emit(res, { type: "result", data: { message: sText, conversationId: convIdFast } });
        return;
      }

      const hasImages = messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"));
      let drawingTranscript = "";
      if (hasImages) {
        emit(res, { type: "status", stage: "chat", label: getStatusLabel("transcribing", uiLang) });
        try {
          const tr = await llmFetch({
            model: MODEL_ID,
            messages: [
              { role: "system", content: "Du bist ein präziser Zeichnungs-Transkribierer. Lies das/die angehängte(n) Bild(er) ZEICHENGETREU ab und liste ALLE sichtbaren technischen Angaben auf: Nennmaße mit Toleranzklassen und Abmaßen (z. B. Ø30 g6 -0,007/-0,020), Gewindebezeichnungen vollständig (z. B. M18x1,5 6g + Länge + Freistich), Form-/Lagetoleranzen MIT ihren Bezügen exakt wie dargestellt (z. B. Rundheit 0,003 |A — Bezüge niemals weglassen), Passfedernuten mit Norm, Oberflächen (Ra), Werkstoff, Härte, Losgröße, Zeichnungsnummer, Rev.-Stand. Erfinde NICHTS — Unleserliches als [unleserlich] markieren. Nüchterne Liste, keine Auslegung, keine Empfehlungen." },
              ...messages,
            ],
          }, llmSignal(), "transcribe");
          drawingTranscript = String(tr.res.choices?.[0]?.message?.content || "").slice(0, 4000);
        } catch { /* best-effort */ }
      }

      const transcriptContext = drawingTranscript
        ? `\n\nZEICHNUNGS-TRANSKRIPT (wörtlich abgelesen, VERBINDLICH für alle Zahlen — hat Vorrang vor jeder Normtabelle):\n${drawingTranscript}`
        : "";

      const rawMode = parsed?.mode === "raw";
      const tools = !rawMode && !hasImages ? [{ google_search: {} }] : undefined;

      emit(res, {
        type: "status",
        stage: "chat",
        label: hasImages
          ? getStatusLabel("drawing", uiLang)
          : rawMode
            ? getStatusLabel("raw", uiLang)
            : getStatusLabel("searching", uiLang),
      });

      const langInstruction = uiLang === "de"
        ? "\n\nSPRACHE: Antworte auf Deutsch.\n"
        : `\n\n═══════════════════════════════════════════════════════════════
STRICT LANGUAGE REQUIREMENT:
The user has chosen ${langInfo.name} (code: '${uiLang}').
You MUST formulate your ENTIRE response, engineering analysis, explanations, operation plan, table contents, and recommendations in ${langInfo.name}.
Keep product names and trademarks (e.g. SPANNTOP nova, TOPlus, InoFlex, centroteX, MANOK plus, MANDO) as they are, but all surrounding technical descriptions, steps, and explanations MUST be completely in ${langInfo.name}!
═══════════════════════════════════════════════════════════════\n`;

      const sysPrompt = (rawMode
        ? RAW_PROMPT
        : SYSTEM_PROMPT_BODY.replace(/BASE_URL_PLACEHOLDER/g, BASE_URL) + machineContext + goldContext + followupContext + fitsContext + catalogContext + shopContext + context + transcriptContext)
        + langInstruction;

      const { res: json, model: mainModel } = await llmFetch({
        model: MODEL_ID,
        messages: [
          { role: "system", content: sysPrompt },
          ...messages,
        ],
        ...(tools ? { tools } : {}),
      }, llmSignal(), rawMode ? "raw" : "main");

      const answer = cleanLaTeX(
        json.choices?.[0]?.message?.content ??
          "Es ist ein Fehler bei der Modellabfrage aufgetreten. Bitte versuche es erneut.",
        BASE_URL
      );

      let finalAnswer = answer;
      const needsQa = answer.length > 400 && (
        answer.includes("OP 10") ||
        answer.includes("OP 20") ||
        answer.includes("Arbeitsplan") ||
        answer.includes("Spannmittel") ||
        answer.includes("Abstechen") ||
        answer.includes("Reiben") ||
        answer.includes("Bohrstange") ||
        answer.includes("Lösung") ||
        hasImages ||
        answer.length > 1500
      );

      if (needsQa && !rawMode) {
        emit(res, { type: "status", stage: "chat", label: getStatusLabel("qa", uiLang) });
        const qaSysPrompt = buildQaSystemPrompt(uiLang);
        try {
          const { res: qj } = await llmFetch({
            model: MODEL_QA,
            messages: [
              { role: "system", content: qaSysPrompt },
              { role: "user", content: `NUTZERFRAGE:\n${questionText}\n\nVORBEBERECHNETE PASSUNGEN:\n${precomputed || "—"}\n\nKATALOG-KONTEXT:\n${catalogContext || "—"}\n\nSHOP-KONTEXT:\n${shopContext || "—"}\n\nZEICHNUNGS-TRANSKRIPT (verbindlich, wörtlich abgelesen):\n${drawingTranscript || "—"}\n\nENTWURF ZU PRÜFEN:\n${answer}` },
            ],
            ...(tools ? { tools } : {}),
          }, llmSignal(), "qa");
          const fixed = qj.choices?.[0]?.message?.content;
          if (fixed && fixed.length > 500) finalAnswer = fixed;
        } catch {}
      }

      try {
        const v = verifyFitNumbers(finalAnswer);
        if (v.corrections.length && v.corrections.length <= 4) {
          finalAnswer = v.fixed;
        } else if (v.corrections.length) {
          console.warn(`[fits] ${v.corrections.length} mismatches left untouched:`, v.corrections.map((c) => `${c.fit}: ${c.wrong}→${c.right}`).join("; "));
        }
      } catch (e) {
        console.warn("[fits] verifier failed:", e.message);
      }

      const cleaned = cleanLaTeX(finalAnswer, BASE_URL);
      const imagesCited = (cleaned.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []);
      logChatInteraction({
        ipHash: hashIp(clientIp(req)),
        country: req.headers["cf-ipcountry"] || null,
        messages: redactMessages(messages),
        question: questionText,
        response: cleaned,
        imagesCited,
        durationMs: Date.now() - startTime,
        stage: "success",
      });
      const convId = await persistChatTurn(req, parsed, questionText, cleaned, Date.now() - startTime, mainModel);
      emit(res, { type: "result", data: { message: cleaned, conversationId: convId } });
    } catch (e) {
      const aborted = aborter.signal.aborted;
      if (!aborted) {
        logChatInteraction({
          ipHash: hashIp(clientIp(req)),
          country: req.headers["cf-ipcountry"] || null,
          messages: redactMessages(messages),
          question: questionText,
          error: String(e.message || "LLM-Fehler").slice(0, 300),
          durationMs: Date.now() - startTime,
          stage: "error",
        });
        emit(res, { type: "error", error: "LLM-Fehler — bitte erneut versuchen." });
      }
    } finally {
      clearInterval(heartbeat);
      try { res.end(); } catch {}
    }
  });
}

module.exports = {
  handleChat,
};
