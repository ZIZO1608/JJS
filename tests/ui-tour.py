"""Browser tour of every screen (Playwright) on a FRESH data folder:
   JJS_DATA_DIR=/tmp/jjs-tour PORT=4396 node dist/server/server/index.js &
   python3 tests/ui-tour.py http://127.0.0.1:4396 docs/screens

Sets up the shop with the sample data through the API, then opens every screen as
Admin (Arabic and English), Manager and Member, saves a screenshot of each and fails on any
page error, console error, failed API call (5xx) or blank screen.
"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4396"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/tour"
os.makedirs(OUT, exist_ok=True)
problems = []


class Api:
    def __init__(self):
        self.cookie = ""

    def __call__(self, method, path, body=None):
        req = urllib.request.Request(BASE + "/api" + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json", "Cookie": self.cookie})
        try:
            with urllib.request.urlopen(req) as r:
                c = r.headers.get("Set-Cookie")
                if c:
                    self.cookie = c.split(";")[0]
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} → {e.code} {e.read()[:200]}")


api = Api()
api("POST", "/auth/setup", {"businessNameAr": "جي جيز", "businessNameEn": "JJ's deli shop", "name": "جوزيف", "username": "jj", "password": "secret123", "language": "ar"})
api("POST", "/system/demo-data")
api("PUT", "/fx/manual", {"rate": 13000})
roles = api("GET", "/roles")["roles"]
for name, user, key in [("رامي", "rami", "manager"), ("سامي", "sami", "member")]:
    api("POST", "/users", {"name": name, "username": user, "password": "pass1234", "roleId": next(r["id"] for r in roles if r["systemKey"] == key)})
# a little activity so screens have content
cat = api("GET", "/menu/catalog")
prods = {p["code"]: p for p in cat["products"]}
methods = {m["systemKey"]: m for m in api("GET", "/money/methods")["rows"]}
clients = {c["name"]: c for c in api("GET", "/clients")["rows"]}
reps = api("GET", "/money/reps")["rows"]
made = api("POST", "/stock/produce", {"productId": prods["TC"]["id"], "qty": 12})
api("POST", "/orders", {"clientId": clients["Focus Study Zone"]["id"], "fulfilment": "delivery", "assignedTo": reps[0]["id"], "methodId": methods["cash"]["id"], "lines": [{"productId": prods["TC"]["id"], "qty": 6, "optionIds": []}]})
api("POST", "/orders", {"clientId": clients["Bean & Book Café"]["id"], "methodId": methods["credit"]["id"], "lines": [{"productId": prods["CLUB"]["id"], "qty": 4, "optionIds": []}, {"productId": prods["LEMON"]["id"], "qty": 4, "optionIds": []}]})
api("POST", "/orders", {"methodId": methods["sham"]["id"], "lines": [{"productId": prods["HAL"]["id"], "qty": 2, "optionIds": []}]})
order_id = api("GET", "/orders")["rows"][0]["id"]
api("POST", f"/clients/{clients['Focus Study Zone']['id']}/recurring", {"days": [0, 1, 2, 3, 4, 5, 6], "lines": [{"productId": prods["TC"]["id"], "qty": 15, "optionIds": []}]})
api("POST", "/assets", {"nameAr": "برّاد", "nameEn": "Fridge", "price": 600, "currency": "USD", "purchaseDate": "2026-01-01", "lifeMonths": 60})
api("POST", "/money/opening", {"boxId": next(b["id"] for b in api("GET", "/money/boxes")["rows"] if b["systemKey"] == "main_cash"), "amount": 200})
focus = clients["Focus Study Zone"]["id"]
batch_id = made["batchId"]

ADMIN_ROUTES = [
    "/", "/dashboard", "/orders", "/orders/new", "/close", "/clients", f"/clients/{focus}",
    "/menu/products", "/menu/categories", "/menu/addons",
    "/warehouse/fridge", "/warehouse/produce", "/warehouse/items", "/warehouse/moves", "/warehouse/places",
    "/purchasing/list", "/purchasing/new", "/purchasing/suppliers",
    "/costing/products", "/costing/ingredients", "/costing/overheads", "/costing/prep",
    "/expenses", "/assets", "/people/employees", "/people/advances", "/people/payroll", "/people/calls",
    "/reports", "/users", "/roles", "/audit",
    "/settings/business", "/settings/lists", "/settings/currency", "/settings/taxes", "/settings/money", "/settings/sales", "/settings/printing", "/settings/network", "/settings/backups",
]
PRINT_ROUTES = [f"/print/receipt/{order_id}", f"/print/labels?batches={batch_id}&copies=2", f"/print/statement/{focus}?from=2026-01-01&to=2030-12-31", "/print/report"]
SIMPLE_ROUTES = ["/", "/orders/new", "/orders", "/warehouse", "/clients", f"/clients/{focus}", "/close", "/expenses", "/reports"]


def slug(path):
    return path.strip("/").replace("/", "-").split("?")[0] or "home"


def watch(page, who):
    page.on("pageerror", lambda e: problems.append(f"[{who}] pageerror on {page.url}: {e}"))
    page.on("console", lambda m: problems.append(f"[{who}] console on {page.url}: {m.text}") if m.type == "error" and "403" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: problems.append(f"[{who}] {r.status} {r.url}") if r.status >= 500 else None)


def login(page, user, pw):
    page.goto(BASE + "/")
    page.fill("#login-user", user)
    page.fill("#login-pass", pw)
    page.keyboard.press("Enter")
    page.wait_for_selector("header")


def visit(page, who, path, prefix, check_text=True):
    page.goto(BASE + path)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(400)
    body = page.inner_text("body").strip()
    if check_text and len(body) < 40:
        problems.append(f"[{who}] nearly empty screen: {path}")
    page.screenshot(path=f"{OUT}/{prefix}-{slug(path)}.png", full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    # Admin, Arabic then English
    ctx = b.new_context(viewport={"width": 1366, "height": 860})
    page = ctx.new_page()
    page.add_init_script("window.print = () => { window.__printed = (window.__printed || 0) + 1; }")
    watch(page, "admin")
    login(page, "jj", "secret123")
    for r in ADMIN_ROUTES:
        visit(page, "admin", r, "admin-ar")
    for r in PRINT_ROUTES:
        visit(page, "admin", r, "print", check_text=False)
    page.goto(BASE + "/")
    page.get_by_role("button", name="EN").click()
    page.wait_for_timeout(300)
    for r in ADMIN_ROUTES:
        visit(page, "admin-en", r, "admin-en")
    ctx.close()

    # Manager and member on a smaller laptop screen and on a phone
    for user, who, vp in [("rami", "manager", {"width": 1180, "height": 820}), ("sami", "member", {"width": 1180, "height": 820}), ("rami", "manager-phone", {"width": 390, "height": 844})]:
        ctx = b.new_context(viewport=vp)
        page = ctx.new_page()
        page.add_init_script("window.print = () => {}")
        watch(page, who)
        login(page, user, "pass1234")
        for r in SIMPLE_ROUTES:
            visit(page, who, r, who)
        ctx.close()
    b.close()

if problems:
    print("PROBLEMS:")
    for x in problems:
        print(" -", x)
    sys.exit(1)
print(f"Screen tour passed. Screenshots in {OUT}")
