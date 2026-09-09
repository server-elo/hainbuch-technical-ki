const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { getStatusLabel, buildSystemPrompt, UI_LANG_MAP } = require("../server/prompts/systemPrompt.cjs");
const { buildQaSystemPrompt } = require("../server/prompts/qaChecklist.cjs");

describe("HAINBUCH Technical Advisor Rules & Prompt Engineering", () => {
  test("localized status labels return correct language strings", () => {
    assert.strictEqual(getStatusLabel("qa", "de"), "Qualitätsprüfung der Auslegung…");
    assert.strictEqual(getStatusLabel("qa", "en"), "Checking solution quality…");
    assert.strictEqual(getStatusLabel("qa", "tr"), "Çözüm kalite kontrolü yapılıyor…");
    assert.strictEqual(getStatusLabel("moment", "it"), "Un momento…");
  });

  test("buildSystemPrompt enforces target language strictly", () => {
    const promptTr = buildSystemPrompt({ uiLang: "tr", baseUrl: "https://test.hainbuch.com" });
    assert.match(promptTr, /STRICT LANGUAGE REQUIREMENT:/);
    assert.match(promptTr, /Turkish/);
    assert.match(promptTr, /https:\/\/test\.hainbuch\.com\/hero-img\/hero_94\.jpg/);

    const promptDe = buildSystemPrompt({ uiLang: "de" });
    assert.doesNotMatch(promptDe, /STRICT LANGUAGE REQUIREMENT:/);
  });

  test("QA checklist allows asking for missing dimensions without fake OP 10/20", () => {
    const qaPrompt = buildQaSystemPrompt("de");
    assert.match(qaPrompt, /VOLLSTÄNDIGER ARBEITSPLAN & FOTOS NUR BEI VORLIEGENDEN MASSEN \/ ZEICHNUNGEN:/);
    assert.match(qaPrompt, /erfinde keine Maße!/);
  });

  test("smalltalk regex detects greetings and rejects technical inquiries", () => {
    const isSmalltalk = (q) => {
      if (!q || q.length > 40) return false;
      if (/\d/.test(q)) return false;
      if (/[Øø]|\bmm\b|\bµm\b|\bISO\b|\bH7\b|\bh6\b|\bk6\b|spann|futter|mando|toplus|manok|inoflex|centrotex|dreh|fräs|bohr|reib|werkst|passung|schnitt|maschine/i.test(q)) return false;
      return /^(hi|hey|hello|hallo|guten\s*(tag|morgen|abend)?|moin|servus|grüezi|danke|thanks?|bitte|ok|okay|ja|nein|tschüss|bye|ciao)\b[.!?\s]*$/i.test(q);
    };

    assert.ok(isSmalltalk("Hallo"));
    assert.ok(isSmalltalk("Hey"));
    assert.ok(isSmalltalk("Guten Tag!"));
    assert.ok(isSmalltalk("danke"));

    assert.strictEqual(isSmalltalk("hallo ich brauche 400 zylinderköpfe"), false, "Numbers & components must not match smalltalk");
    assert.strictEqual(isSmalltalk("SPANNTOP Futter"), false, "Technical terms must not match smalltalk");
    assert.strictEqual(isSmalltalk("Ø 50 mm Passung"), false, "Dimensions must not match smalltalk");
  });

  test("PDF and image attachments are preserved in API message mapping", () => {
    const parts = [
      { inlineData: { data: "JVBERi0xLjQK...", mimeType: "application/pdf" } },
      { inlineData: { data: "iVBORw0KGgo...", mimeType: "image/png" } },
      { text: "Hier ist die Zeichnung" }
    ];

    const attachments = parts
      .filter((p) => p.inlineData && (
        String(p.inlineData.mimeType || "").startsWith("image/") ||
        p.inlineData.mimeType === "application/pdf"
      ))
      .map((p) => ({
        type: "image_url",
        image_url: { url: `data:${p.inlineData.mimeType};base64,${String(p.inlineData.data || "")}` },
      }));

    assert.strictEqual(attachments.length, 2);
    assert.strictEqual(attachments[0].type, "image_url");
    assert.ok(attachments[0].image_url.url.startsWith("data:application/pdf;base64,"));
    assert.strictEqual(attachments[1].type, "image_url");
    assert.ok(attachments[1].image_url.url.startsWith("data:image/png;base64,"));
  });
});
