"""Screens for the "Setting up" chapter (printer, receipts). Writes shots-setup.json.
Run against the DEMO shop, then:  python <skill>/scripts/capture.py shots-setup.json --out shots
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
base = json.loads((HERE / "shots.json").read_text(encoding="utf-8"))
ORDER = "01a1f0cf-1277-723e-ae2f-4eaf81bb0788"  # a sample sale in the demo shop


def t(en, ar, tag="button"):
    return f'{tag}:text-is("{en}"), {tag}:text-is("{ar}")'


def sec(en, ar):
    return f"main section:has(h2:text-is('{en}')), main section:has(h2:text-is('{ar}'))"


ROLL = lambda roll: {"eval": f"fetch('/api/system/printer-roll', {{method: 'PUT', headers: {{'content-type': 'application/json'}}, body: JSON.stringify({{roll: '{roll}'}})}})"}

screens = [
    {"id": "print-printer", "url": "/settings/printing", "actions": [{"wait": 600}],
     "clip": sec("Printer: Xprinter XP-236B", "الطابعة: Xprinter XP-236B"), "clip_padding": 8,
     "callouts": [{"key": "preset", "selector": t("Use settings for this printer", "اضبط الإعدادات لهالطابعة")},
                  {"key": "size", "selector": t("50×30", "50×30")},
                  {"key": "invoice", "selector": t("Print test invoice", "اطبع فاتورة تجربة")},
                  {"key": "label", "selector": t("Print test label", "اطبع ملصق تجربة")}]},
    {"id": "print-computer", "url": "/settings/printing", "actions": [{"wait": 600}],
     "clip": sec("This computer", "هالكمبيوتر"), "clip_padding": 8,
     "callouts": [{"key": "labelp", "selector": "#bp-label"}, {"key": "receiptp", "selector": "#bp-receipt"},
                  {"key": "shared", "selector": "main label:has-text('share one printer'), main label:has-text('نفس الطابعة')"},
                  {"key": "auto", "selector": "main label:has-text('after every sale'), main label:has-text('بعد كل بيعة')"}]},
    {"id": "print-centre", "url": "/settings/printing", "actions": [{"wait": 600}],
     "clip": "main div.rounded-xl:has(#ac-l)", "clip_padding": 8,
     "callouts": [{"key": "first", "selector": "#ac-l"}, {"key": "last", "selector": "#ac-r"},
                  {"key": "centre", "selector": t("Centre it", "وسّطها")}]},
    {"id": "print-invoices", "url": "/settings/printing", "actions": [{"wait": 600}],
     "clip": sec("Invoices", "الفواتير"), "clip_padding": 8,
     "callouts": [{"key": "wa", "selector": "#pr-wa"}, {"key": "social", "selector": "#pr-so"},
                  {"key": "qr", "selector": "main label:has-text('digital receipt'), main label:has-text('فاتورتك أونلاين')"},
                  {"key": "save", "selector": "main button.btn-primary:text-is('Save'), main button.btn-primary:text-is('حفظ')"}]},
    {"id": "roll-swap", "url": "/", "actions": [ROLL("label"), {"wait": 400}, {"goto": f"/print/receipt/{ORDER}"}, {"wait": 900}],
     "clip": "div.card:has(button:text-is('Cancel')), div.card:has(button:text-is('إلغاء'))", "clip_padding": 10,
     "callouts": [{"key": "swapped", "selector": "div.card .btn-primary"}]},
    {"id": "receipt", "url": "/", "actions": [ROLL("receipt"), {"wait": 400}, {"goto": f"/print/receipt/{ORDER}"}, {"wait": 1200}],
     "clip": "div.mx-auto.bg-white", "clip_padding": 6, "callouts": []},
]

cfg = {k: v for k, v in base.items() if k != "screens"}
cfg["screens"] = screens
(HERE / "shots-setup.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
print("wrote", len(screens), "screens")
