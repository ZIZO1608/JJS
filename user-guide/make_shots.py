"""Writes shots.json (admin screens) and shots-member.json (Member's simple screens) for the user guide.

Run against the DEMO shop (sample data), never the real one:
    python make_shots.py && python <skill>/scripts/capture.py shots.json --out shots
Selectors list the English and the Arabic label so one config works in both languages.
"""
import json
from pathlib import Path

HERE = Path(__file__).parent
BASE = "http://127.0.0.1:4396"


def t(en, ar, tag="button"):
    """An element by its exact text in either language."""
    return f'{tag}:text-is("{en}"), {tag}:text-is("{ar}")'


def has(en, ar, tag="button"):  # noqa: E302
    return f'{tag}:has-text("{en}"), {tag}:has-text("{ar}")'


def nav(path):
    return f'nav[aria-label=Sections] a[href="{path}"]'


DLG = "[role=dialog]"
LOGOUT = {"eval": "fetch('/api/auth/logout', {method: 'POST'}).then(() => location.assign('/'))"}
LOGIN = [{"fill": {"selector": "#login-user", "value": "jabal"}}, {"fill": {"selector": "#login-pass", "value": "jabal123"}}, {"press": "Enter"}, {"wait_for": "header"}]

screens = [
    # ---------- getting started ----------
    {"id": "login", "url": "/", "actions": [LOGOUT, {"wait": 900}, {"wait_for": "#login-user"}],
     "clip": "div:has(> form)", "clip_padding": 20,
     "callouts": [{"key": "user", "selector": "#login-user"}, {"key": "pass", "selector": "#login-pass"}, {"key": "go", "selector": "form .btn-primary"}]},
    {"id": "home", "url": None, "actions": LOGIN + [{"goto": "/"}],
     "callouts": [{"key": "menu", "selector": "nav[aria-label=Sections]"}, {"key": "lang", "selector": t("EN", "EN")},
                  {"key": "user", "selector": "header button:has(span:text-is('J'))"}, {"key": "rate", "selector": "header :text-matches('^1 (USD|دولار)')"},
                  {"key": "five", "selector": "main div.card:has(h2:text-is('Your day in five answers')), main div.card:has(h2:text-is('يومك بخمس أجوبة'))"},
                  {"key": "neworder", "selector": has("+ New order", "+ طلب جديد", "a")}]},
    {"id": "usermenu", "url": "/", "actions": [{"click": "header button:has(span:text-is('J'))"}, {"wait": 300}],
     "callouts": [{"key": "pwd", "selector": t("Change password", "تغيير كلمة المرور")}, {"key": "out", "selector": t("Log out", "تسجيل الخروج")}]},
    {"id": "password", "url": None, "actions": [{"click": t("Change password", "تغيير كلمة المرور")}, {"wait_for": DLG}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "cur", "selector": "#pw-cur"}, {"key": "new", "selector": "#pw-new"}, {"key": "save", "selector": f"{DLG} .btn-primary"}]},
    # ---------- orders ----------
    {"id": "order-who", "url": "/orders/new", "clip": "main", "clip_padding": 0, "css": " main { max-height: 250px; overflow: hidden; }",
     "callouts": [{"key": "steps", "selector": "main ol, main [aria-label=steps], main div:has(> button:has-text('1')) >> nth=0"},
                  {"key": "walkin", "selector": t("Walk-in", "زبون عابر")}, {"key": "account", "selector": t("Account client", "زبون مسجّل")},
                  {"key": "trial", "selector": t("Free trial", "تجربة مجانية")}, {"key": "staff", "selector": t("Staff purchase", "شراء موظف")},
                  {"key": "tasting", "selector": t("Tasting / internal", "تذوّق / داخلي")}]},
    {"id": "order-addons", "url": None, "actions": [{"click": t("Walk-in", "زبون عابر")}, {"wait": 300},
                                                   {"click": "main button:has-text('Turkey & Cheddar'), main button:has-text('حبش وشيدر')"}, {"wait_for": DLG},
                                                   {"click": f"{DLG} button:has-text('Double filling'), {DLG} button:has-text('حشوة مضاعفة')", "optional": True}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "extras", "selector": f"{DLG} button:has-text('Double filling'), {DLG} button:has-text('حشوة مضاعفة')"},
                  {"key": "qty", "selector": f"{DLG} button:text-is('+')"}, {"key": "add", "selector": t("Add to order", "أضف للطلب")}]},
    {"id": "order-items", "url": None, "actions": [{"click": t("Add to order", "أضف للطلب")}, {"wait": 300},
                                                  {"click": "main button:has-text('Greek Salad'), main button:has-text('سلطة يونانية')"}, {"wait": 300}],
     "callouts": [{"key": "cats", "selector": t("All", "الكل")}, {"key": "scan", "selector": "#scan"},
                  {"key": "product", "selector": "main button:has-text('Greek Salad'), main button:has-text('سلطة يونانية')"},
                  {"key": "cart", "selector": "main aside, main div.card:has-text('Subtotal'), main div.card:has-text('المجموع') >> nth=0"},
                  {"key": "next", "selector": t("Next: payment", "التالي: الدفع")}]},
    {"id": "order-pay", "url": None, "actions": [{"click": t("Next: payment", "التالي: الدفع")}, {"wait": 400}],
     "callouts": [{"key": "pickup", "selector": t("Pickup", "استلام من المحل")}, {"key": "method", "selector": t("Cash", "كاش")},
                  {"key": "paid", "selector": "#paidnow"}, {"key": "disc", "selector": "#mdisc"},
                  {"key": "print", "selector": "main label:has(input[type=checkbox])"}, {"key": "confirm", "selector": t("Confirm order", "تأكيد الطلب")}]},
    {"id": "order-saved", "url": None, "actions": [{"click": t("Confirm order", "تأكيد الطلب")}, {"wait": 700}],
     "clip": "main button:text-is('Print receipt'), main button:text-is('طباعة الفاتورة') >> xpath=..", "clip_padding": 40,
     "callouts": [{"key": "receipt", "selector": t("Print receipt", "طباعة الفاتورة")}, {"key": "a4", "selector": t("A4 invoice", "فاتورة A4")},
                  {"key": "again", "selector": t("New order", "طلب جديد")}]},
    {"id": "order-account", "url": "/orders/new", "actions": [{"click": t("Account client", "زبون مسجّل")}, {"wait": 400}],
     "callouts": [{"key": "search", "selector": "main input[type=search], main input[placeholder*='phone'], main input[placeholder*='الهاتف']"},
                  {"key": "client", "selector": "main button:has-text('Bean & Book'), main button:has-text('Bean')"},
                  {"key": "newc", "selector": t("+ New client", "+ زبون جديد")}]},
    {"id": "order-credit", "url": None, "actions": [{"click": "main button:has-text('Bean & Book')"}, {"wait": 300},
                                                   {"click": "main button:has-text('Greek Salad'), main button:has-text('سلطة يونانية')"},
                                                   {"click": "main button:has-text('Greek Salad'), main button:has-text('سلطة يونانية')"},
                                                   {"click": "main button:has-text('Caesar Salad'), main button:has-text('سلطة سيزر')"}, {"wait": 200},
                                                   {"click": t("Next: payment", "التالي: الدفع")}, {"wait": 300},
                                                   {"click": t("Cash", "كاش")}, {"fill": {"selector": "#paidnow", "value": "5"}}, {"wait": 300}],
     "callouts": [{"key": "paid", "selector": "#paidnow"}, {"key": "balance", "selector": "main :text-matches('Client balance|رصيد الزبون')"},
                  {"key": "credit", "selector": t("On credit", "دين (على الحساب)")}]},
    {"id": "order-delivery", "url": None, "actions": [{"click": t("Delivery", "توصيل")}, {"wait": 400}],
     "clip": "main div.card:has-text('Delivered by'), main div.card:has-text('مين يوصّل') >> nth=0", "clip_padding": 10,
     "callouts": [{"key": "delivery", "selector": t("Delivery", "توصيل")}]},
    {"id": "orders-list", "url": "/orders",
     "callouts": [{"key": "date", "selector": "main button[aria-haspopup=dialog]"}, {"key": "search", "selector": "main input"},
                  {"key": "row", "selector": "main tbody tr >> nth=0"}, {"key": "new", "selector": has("+ New order", "+ طلب جديد", "a")}]},
    {"id": "order-detail", "url": None, "actions": [{"click": "main tbody tr >> nth=0"}, {"wait_for": DLG}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "cancel", "selector": t("Cancel order", "إلغاء الطلب")}, {"key": "ret", "selector": f"{DLG} " + t("Return", "مرتجع").replace(", ", f", {DLG} ")},
                  {"key": "deliv", "selector": t("Mark delivered", "تم التسليم")}, {"key": "a4", "selector": t("A4", "A4")},
                  {"key": "print", "selector": t("Print receipt", "طباعة الفاتورة")}]},
    # ---------- clients ----------
    {"id": "clients", "url": "/clients",
     "callouts": [{"key": "new", "selector": t("+ New client", "+ زبون جديد")}, {"key": "filters", "selector": has("Owe money", "عليهم دين")},
                  {"key": "row", "selector": "main tbody tr:has-text('Bean & Book')"}]},
    {"id": "client-new", "url": None, "actions": [{"click": t("+ New client", "+ زبون جديد")}, {"wait_for": DLG}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "type", "selector": "#c-type"}, {"key": "name", "selector": "#c-name"}, {"key": "phone", "selector": "#c-phone"},
                  {"key": "terms", "selector": "#c-terms"}, {"key": "limit", "selector": "#c-limit"}]},
    {"id": "client-page", "url": "/clients", "actions": [{"press": "Escape", "optional": True}, {"click": "main tbody tr:has-text('Bean & Book')"}, {"wait": 600}],
     "callouts": [{"key": "pay", "selector": t("Record payment", "سجّل دفعة")}, {"key": "balance", "selector": "main div.card >> nth=0"},
                  {"key": "limit", "selector": "main div.card:has-text('Credit limit'), main div.card:has-text('حد الدين') >> nth=0"},
                  {"key": "statement", "selector": "[role=tab]:text-is('Statement'), [role=tab]:text-is('كشف حساب')"}]},
    {"id": "client-payment", "url": None, "actions": [{"click": t("Record payment", "سجّل دفعة")}, {"wait_for": DLG}, {"fill": {"selector": "#p-amount", "value": "5"}}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "amount", "selector": "#p-amount"}, {"key": "cur", "selector": "#p-cur"}, {"key": "method", "selector": "#p-method"},
                  {"key": "kind", "selector": "#p-kind"}, {"key": "save", "selector": f"{DLG} .btn-primary"}]},
    # ---------- kitchen & stock ----------
    {"id": "production", "url": "/production", "actions": [{"press": "Escape", "optional": True},
                                                          {"click": "main div:has(> div:has-text('TC')) button:text-is('+') >> nth=0", "optional": True}, {"wait": 150},
                                                          {"fill": {"selector": "main input >> nth=2", "value": "30"}}, {"wait": 600}],
     "callouts": [{"key": "qty", "selector": "main input >> nth=2"}, {"key": "materials", "selector": "main h3:text-is('Materials needed'), main h3:text-is('المواد اللازمة')"},
                  {"key": "by", "selector": "#pr-e"}, {"key": "place", "selector": "#pr-l"}, {"key": "confirm", "selector": t("Confirm production", "اعتماد الإنتاج")}]},
    {"id": "warehouse", "url": "/warehouse",
     "callouts": [{"key": "tabs", "selector": "main [role=tablist]"}, {"key": "scan", "selector": "main input >> nth=0"},
                  {"key": "batch", "selector": "main button:has-text('B-1021-01')"}]},
    {"id": "batch", "url": None, "actions": [{"click": "main button:has-text('B-1021-01')"}, {"wait_for": DLG}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "labels", "selector": t("Print labels", "اطبع ملصقات")}, {"key": "waste", "selector": f"{DLG} " + t("Waste", "هدر").replace(", ", f", {DLG} ")},
                  {"key": "move", "selector": t("Move", "انقل") + ", button:text-is('نقل')"}, {"key": "count", "selector": t("Count", "جرد")},
                  {"key": "who", "selector": t("Who got this batch?", "مين أخد من هالدفعة؟", "a")}]},
    {"id": "waste", "url": None, "actions": [{"click": f"{DLG} " + t("Waste", "هدر").replace(", ", f", {DLG} ")}, {"wait": 400}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "qty", "selector": "#w-qty"}, {"key": "reason", "selector": "#w-reason"}, {"key": "save", "selector": f"{DLG} .btn-primary"}]},
    # ---------- money ----------
    {"id": "expense", "url": "/expenses", "actions": [{"press": "Escape", "optional": True}, {"click": "main .btn-primary >> nth=0"}, {"wait": 400}],
     "clip": "main div.card >> nth=0", "clip_padding": 8,
     "callouts": [{"key": "item", "selector": "#x-item"}, {"key": "cat", "selector": "#x-cat"}, {"key": "amount", "selector": "#x-amt"},
                  {"key": "box", "selector": "#x-box"}, {"key": "date", "selector": "#x-date"}, {"key": "save", "selector": "main div.card >> nth=0 >> .btn-primary"}]},
    {"id": "dropdown", "url": None, "actions": [{"click": "#x-box"}, {"wait": 300}], "clip": "main div.card >> nth=0", "clip_padding": 8,
     "callouts": [{"key": "list", "selector": ".dd-pop"}]},
    {"id": "calendar", "url": None, "actions": [{"press": "Escape"}, {"click": "#x-date"}, {"wait": 300}],
     "callouts": [{"key": "month", "selector": ".cal-title"}, {"key": "today", "selector": ".cal-pop .cal-link.text-brand"}, {"key": "sel", "selector": ".cal-sel"}]},
    {"id": "close", "url": "/close", "actions": [{"press": "Escape", "optional": True}],
     "callouts": [{"key": "rep", "selector": t("Cash received", "استلمت الكاش")}, {"key": "count", "selector": "main input >> nth=0"},
                  {"key": "withdraw", "selector": t("Personal withdrawal", "سحب شخصي")}]},
    {"id": "close-lock", "url": None, "actions": [{"scroll_to": "main section.card:has(h2:has-text('3 ·'))"}],
     "clip": "main section.card:has(h2:has-text('3 ·'))", "clip_padding": 8,
     "callouts": [{"key": "lock", "selector": t("Close the day", "اقفل اليوم")}]},
    # ---------- managing ----------
    {"id": "menu", "url": "/menu",
     "callouts": [{"key": "tabs", "selector": "main [role=tablist]"}, {"key": "new", "selector": t("+ Product", "+ منتج")},
                  {"key": "row", "selector": "main tbody tr:has-text('TC')"}, {"key": "margin", "selector": "main th:has-text('Margin'), main th:has-text('الهامش')"}]},
    {"id": "product", "url": None, "css": " [role=dialog] { max-height: 900px; overflow: hidden; }", "actions": [{"click": "main tbody tr:has-text('TC') >> td >> nth=1"}, {"wait_for": DLG}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "cat", "selector": f"{DLG} button[role=combobox] >> nth=0"}, {"key": "price", "selector": f"{DLG} input >> nth=3"},
                  {"key": "recipe", "selector": f"{DLG} :text-matches('^(Cost|الكلفة|التكلفة):')"}]},
    {"id": "purchase", "url": "/purchasing", "actions": [{"press": "Escape", "optional": True}, {"click": "main [role=tablist] a:text-is('New purchase'), main [role=tablist] a:text-is('فاتورة جديدة')"}, {"wait": 500}],
     "callouts": [{"key": "supplier", "selector": "#np-s"}, {"key": "inv", "selector": "#np-r"}, {"key": "disc", "selector": "#np-d"},
                  {"key": "transport", "selector": "#np-t"}, {"key": "due", "selector": "#np-dd"}]},
    {"id": "distribution", "url": "/distribution",
     "callouts": [{"key": "tabs", "selector": "main [role=tablist]"}, {"key": "print", "selector": t("Print route sheet", "اطبع ورقة التوزيع")},
                  {"key": "inv", "selector": t("Invoice", "فاتورة", "a")}, {"key": "cons", "selector": t("Consignment", "بضاعة بالأمانة")},
                  {"key": "ret", "selector": "main " + t("Return", "مرتجع").replace(", ", ", main ")}]},
    {"id": "people", "url": "/people",
     "callouts": [{"key": "tabs", "selector": "main [role=tablist]"}, {"key": "new", "selector": t("+ Employee", "+ موظف")}]},
    {"id": "users", "url": "/users",
     "callouts": [{"key": "new", "selector": t("New user", "مستخدم جديد")}, {"key": "row", "selector": "main tbody tr:has-text('manager1')"},
                  {"key": "deact", "selector": "main tbody tr:has-text('manager1') button:text-is('Deactivate'), main tbody tr:has-text('manager1') button:text-is('إيقاف')"}]},
    {"id": "user-new", "url": None, "actions": [{"click": t("New user", "مستخدم جديد")}, {"wait_for": DLG}],
     "clip": DLG, "clip_padding": 8,
     "callouts": [{"key": "name", "selector": "#u-name"}, {"key": "user", "selector": "#u-username"}, {"key": "pass", "selector": "#u-pass"},
                  {"key": "role", "selector": "#u-role"}, {"key": "lang", "selector": "#u-lang"}]},
    {"id": "roles", "url": "/roles", "actions": [{"press": "Escape", "optional": True}],
     "callouts": [{"key": "list", "selector": "main button:has-text('Manager'), main button:has-text('المدير') >> nth=0"},
                  {"key": "grid", "selector": "main table"}, {"key": "cost", "selector": "main th:has-text('See costs'), main th:has-text('رؤية التكاليف')"},
                  {"key": "save", "selector": t("Save", "حفظ")}]},
    {"id": "currency", "url": "/settings/currency",
     "callouts": [{"key": "manual", "selector": "#fx-manual"}, {"key": "use", "selector": t("Use this rate", "اعتماد هذا السعر")}, {"key": "api", "selector": "#fx-url"}]},
    {"id": "backups", "url": "/settings/backups", "actions": [{"eval": "document.querySelectorAll('main *').forEach(e => { if (!e.children.length && e.textContent.includes('jjs-guide-demo')) e.textContent = ['C:', 'Users', '…', 'AppData', 'Roaming', 'jjs-erp', 'data', 'backups'].join(String.fromCharCode(92)) })"}],
     "callouts": [{"key": "now", "selector": t("Back up now", "نسخ احتياطي الآن")}, {"key": "restore", "selector": "main button:text-is('Restore'), main button:text-is('استرجاع') >> nth=0"}]},
    # ---------- owner ----------
    {"id": "five", "url": "/",
     "clip": "main div.card:has(h2:text-is('Your day in five answers')), main div.card:has(h2:text-is('يومك بخمس أجوبة'))", "clip_padding": 8,
     "callouts": [{"key": "wa", "selector": t("Send on WhatsApp", "ابعتها واتساب", "a")}]},
    {"id": "reports", "url": "/reports",
     "callouts": [{"key": "presets", "selector": t("This month", "هذا الشهر")}, {"key": "range", "selector": "main button[aria-haspopup=dialog] >> nth=0"},
                  {"key": "print", "selector": t("Print", "طباعة")}, {"key": "pl", "selector": "main h2:text-is('Profit & loss'), main h2:text-is('الأرباح والخسائر')"}]},
    {"id": "reports-more", "url": None, "actions": [{"scroll_to": "main section.card:has(h2:text-is('More reports')), main section.card:has(h2:text-is('تقارير إضافية'))"}],
     "clip": "main section.card:has(h2:text-is('More reports')), main section.card:has(h2:text-is('تقارير إضافية'))", "clip_padding": 8,
     "callouts": []},
    {"id": "costing", "url": "/costing",
     "callouts": [{"key": "tabs", "selector": "main [role=tablist]"}, {"key": "margin", "selector": "main th:text-is('Margin'), main th:text-is('الهامش')"},
                  {"key": "target", "selector": "main th:text-is('Price for target'), main th:text-is('السعر للهدف')"}]},
    {"id": "audit", "url": "/audit",
     "callouts": [{"key": "filter", "selector": "main button[role=combobox] >> nth=0"}, {"key": "row", "selector": "main tbody tr >> nth=0"}]},
]

# Full-screen shots print too small in A4: crop them to the work area (no menu, no top bar).
# The screen tour (home, usermenu) keeps the whole window on purpose.
for sc in screens:
    if "clip" not in sc and sc["id"] not in ("home", "usermenu"):
        sc["clip"], sc["clip_padding"] = "main", 0
        sc["css"] = sc.get("css", "") + " main { max-height: 690px; overflow: hidden; }"
        sc["actions"] = sc.get("actions", []) + [{"eval": "window.scrollTo(0, 0)"}, {"wait": 150}]

cfg = {
    "base_url": BASE,
    "display_base_url": "JJ's ERP",
    "viewport": {"width": 1000, "height": 760},
    "device_scale_factor": 2,
    "delay_ms": 400,
    "hide": ["[role=status]", ".toast"],
    "login": {"url": "/", "actions": LOGIN},
    "languages": {
        "ar": {"setup": [{"click": "header button:text-is('عربي')"}, {"wait_for": "html[dir=rtl]"}], "locale": "ar-SY"},
        "en": {"setup": [{"click": "header button:text-is('EN')"}, {"wait_for": "html[dir=ltr]"}], "locale": "en-GB"},
    },
    "screens": screens,
}
(HERE / "shots.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")

member = dict(cfg)
member["login"] = {"url": "/", "actions": [{"fill": {"selector": "#login-user", "value": "member1"}}, {"fill": {"selector": "#login-pass", "value": "member123"}}, {"press": "Enter"}, {"wait_for": "header"}]}
member["screens"] = [{"id": "member-home", "url": "/", "callouts": [
    {"key": "invoice", "selector": "main a:has-text('New invoice'), main a:has-text('فاتورة جديدة'), main button:has-text('New invoice') >> nth=0"},
    {"key": "tabs", "selector": "nav[aria-label=Sections]"}]}]
(HERE / "shots-member.json").write_text(json.dumps(member, ensure_ascii=False, indent=1), encoding="utf-8")
print("wrote", len(screens), "screens + member")
