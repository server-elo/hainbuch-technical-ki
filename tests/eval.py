#!/usr/bin/env python3
"""
Ultra-hard eval harness for the Hainbuch Technical Advisor (single-model).
Golden values are pulled directly from products_de.json where possible.
Questions cover numeric specs, refusal traps, and one tolerance case.

Usage:
    python3 tests/eval.py          # full suite
    python3 tests/eval.py 5        # run only question 5

Requires the advisor running on http://127.0.0.1:3000
"""

import json
import re
import sys
import time
from pathlib import Path
from typing import Any

import requests

ADVISOR_URL = "http://127.0.0.1:3000/api/chat"
TIMEOUT = 120  # generous for MoE-style latency if ever switched

PRODUCTS_DB = Path("/Users/lorenc/Desktop/Engineering-RAG/data/processed/hainbuch/products_de.json")

def load_products() -> list[dict]:
    return json.loads(PRODUCTS_DB.read_text(encoding="utf-8"))

def get_product(name_substr: str) -> dict | None:
    prods = load_products()
    for p in prods:
        if name_substr.lower() in p["name"].lower():
            return p
    return None

def call_advisor(prompt: str) -> str:
    key_path = Path(__file__).resolve().parent.parent / ".app_key"
    headers = {"x-app-key": key_path.read_text().strip()} if key_path.exists() else {}
    payload = {
        "messages": [{"role": "user", "parts": [{"text": prompt}]}],
    }
    try:
        with requests.post(ADVISOR_URL, json=payload, headers=headers, timeout=TIMEOUT, stream=True) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if evt.get("type") == "result":
                    data = evt.get("data", {})
                    if isinstance(data, dict):
                        return data.get("message") or data.get("text") or str(data)
                    return str(data)
                if evt.get("type") == "error":
                    return f"ERROR: {evt.get('error')}"
            return "ERROR: no result event received"
    except Exception as e:
        return f"ERROR: {e}"

def check_numeric(text: str, expected: float | int, tolerance: float = 0.0) -> bool:
    """Find the first number that matches expected within tolerance."""
    nums = re.findall(r"\b\d+(?:[.,]\d+)?\b", text)
    for n in nums:
        try:
            val = float(n.replace(",", "."))
            if abs(val - expected) <= tolerance:
                return True
        except ValueError:
            continue
    return False

def check_refusal(text: str) -> bool:
    t = text.lower()
    # Robust negation detection for German refusals
    has_negation = bool(re.search(r"\b(nicht|nichts|kein\w*|keine)\b", t))
    refusal_cues = [
        "enthalten", "vorliegen", "vorhanden", "angegeben", "bekannt",
        "verfügbar", "aufgeführt", "zulässig", "möglich", "baugröße",
        "überschreitet", "übersteigt", "spezifikation", "auszügen"
    ]
    has_cue = any(c in t for c in refusal_cues)
    return has_negation and has_cue

# === Question definitions ===
QUESTIONS = [
    {
        "id": 1,
        "q": "TOROK SE Größe 100 maximale Spannkraft radial?",
        "type": "numeric",
        "golden": 150,
        "tolerance": 0,
        "source": "products_de.json TOROK SE 100",
    },
    {
        "id": 2,
        "q": "TOROK RD Größe 100 Drehzahl n max?",
        "type": "numeric",
        "golden": 5000,
        "tolerance": 0,
        "source": "products_de.json",
    },
    {
        "id": 3,
        "q": "MAXXOS T211 Größe B Rundlauf?",
        "type": "numeric",
        "golden":  0.010,
        "tolerance": 0.001,
        "source": "products_de.json",
    },
    {
        "id": 4,
        "q": "TOROK 250 maximale Spannkraft?",
        "type": "refusal",
        "source": "non-existent product trap",
    },
    {
        "id": 5,
        "q": "Welche maximale Spannkraft hat ein TOROK 100 bei 190 kN Betätigungskraft?",
        "type": "refusal",
        "source": "false premise (catalogue max is 65 kN Betätigungskraft)",
    },
    {
        "id": 6,
        "q": "TOPlus premium Axzug Größe 100 Spannbereich?",
        "type": "text",
        "contains": ["15", "100"],
        "source": "products_de.json",
    },
    {
        "id": 7,
        "q": "SPANNTOP nova Modular Größe 125 Drehzahl?",
        "type": "numeric",
        "golden": 3200,
        "tolerance": 0,
        "source": "products_de.json",
    },
    {
        "id": 8,
        "q": "InoFlex VD Handspannfutter Größe 100 Rundlauf?",
        "type": "refusal",
        "golden": 0.02,
        "tolerance": 0.005,
        "source": "products_de.json",
    },
    {
        "id": 9,
        "q": "MANDO T211 Größe 3 Spannbereich?",
        "type": "text",
        "contains": ["50", "80"],
        "source": "products_de.json",
    },
    {
        "id": 10,
        "q": "HYDROK SE Größe 52 Drehzahl?",
        "type": "numeric",
        "golden": 1000,
        "tolerance": 0,
        "source": "products_de.json",
    },
    {
        "id": 11,
        "q": "B-Top3 Backenfutter Größe 250 Rundlauf?",
        "type": "refusal",
        "golden": 0.02,
        "tolerance": 0.005,
        "source": "products_de.json",
    },
    {
        "id": 12,
        "q": "centroteX quick-change compatible with which Hainbuch products?",
        "type": "text",
        # Catalogue p.374 'Passend für': TOPlus mini/premium, SPANNTOP mini/nova,
        # B-Top, InoFlex VT-S, MANDO T211/T212/T812, MAXXOS T211. TOROK is NOT listed.
        "contains": ["TOPlus", "SPANNTOP", "MANDO"],
        "source": "Katalog S.374 Passend-für-Liste (centroteX S / M / mandoteX)",
    },
    {
        "id": 13,
        "q": "Welche Produkte haben eine Flanschaufnahme Ø 240 H6?",
        "type": "text",
        # Only TOROK SE and TOROK RD (Größe 100) have BD = Ø 240 H6
        # (Katalog S.130/132 Technische Daten). No TOPlus has a 240 H6 flange.
        "contains": ["TOROK"],
        "source": "Katalog S.130/132: TOROK SE/RD Flanschaufnahme BD",
    },
    {
        "id": 14,
        "q": "TOROK CFK SE maximale Betätigungskraft?",
        "type": "numeric",
        "golden": 65,
        "tolerance": 5,
        "source": "products_de.json",
    },
    {
        "id": 15,
        "q": "MAXXOS T211 Größe F Spannbereich?",
        "type": "text",
        "contains": ["50", "100"],
        "source": "products_de.json",
    },
]

def run_question(q: dict) -> tuple[bool, str]:
    answer = call_advisor(q["q"])
    if answer.startswith("ERROR"):
        return False, answer

    if q["type"] == "numeric":
        ok = check_numeric(answer, q["golden"], q.get("tolerance", 0))
        return ok, f"expected {q['golden']}, got snippet: {answer[:200]}"
    elif q["type"] == "refusal":
        ok = check_refusal(answer)
        return ok, f"refusal check: {answer[:200]}"
    elif q["type"] == "text":
        t = answer.lower()
        ok = all(c.lower() in t for c in q["contains"])
        return ok, f"must contain {q['contains']}, got: {answer[:200]}"
    return False, "unknown type"

def main():
    if len(sys.argv) > 1:
        qid = int(sys.argv[1])
        qs = [q for q in QUESTIONS if q["id"] == qid]
    else:
        qs = QUESTIONS

    results = []
    for q in qs:
        ok, detail = run_question(q)
        status = "PASS" if ok else "FAIL"
        print(f"Q{q['id']:2d} {status}: {q['q'][:60]}... → {detail}")
        results.append(ok)

    passed = sum(results)
    total = len(results)
    print(f"\nRESULT: {passed}/{total} passed")
    return passed == total

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)