"""Real click-through of the daily flows (Playwright), on a FRESH data folder:
   JJS_DATA_DIR=/tmp/jjs-flows PORT=4394 node dist/server/server/index.js &
   python3 tests/ui-flows.py http://127.0.0.1:4394 /tmp/flows

1. Admin: a shop invoice paid in part (the rest goes on the account).
2. Admin: the morning production run.
3. Admin: a return from the client page.
4. Manager (simple screens): a walk-in sale, then counting the box and closing the day.
"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4394"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/flows"
os.makedirs(OUT, exist_ok=True)
problems = []
cookie = {"v": ""}


def api(method, path, body=None):
    req = urllib.request.Request(BASE + "/api" + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type": "application/json", "Cookie": cookie["v"]})
    with urllib.request.urlopen(req) as r:
        c = r.headers.get("Set-Cookie")
        if c:
            cookie["v"] = c.split(";")[0]
        return json.loads(r.read() or b"null")


api("POST", "/auth/setup", {"businessNameAr": "جي جيز", "businessNameEn": "JJ's Kitchen", "name": "Owner", "username": "jj", "password": "secret123", "language": "en"})
api("POST", "/system/demo-data")
api("PUT", "/fx/manual", {"rate": 13000})
roles = api("GET", "/roles")["roles"]
api("POST", "/users", {"name": "Rami", "username": "rami", "password": "pass1234", "roleId": next(r["id"] for r in roles if r["systemKey"] == "manager")})
main_box = next(b for b in api("GET", "/money/boxes")["rows"] if b["systemKey"] == "main_cash")
api("POST", "/money/opening", {"boxId": main_box["id"], "amount": 100})
clients = {c["name"]: c for c in api("GET", "/clients")["rows"]}


def watch(page, who):
    page.on("pageerror", lambda e: problems.append(f"[{who}] pageerror: {e}"))
    page.on("console", lambda m: problems.append(f"[{who}] console: {m.text}") if m.type == "error" and "401" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: problems.append(f"[{who}] {r.status} {r.url}") if r.status >= 500 else None)


def login(page, user, pw):
    page.goto(BASE + "/")
    page.fill("#login-user", user)
    page.fill("#login-pass", pw)
    page.keyboard.press("Enter")
    page.wait_for_selector("header")


def shot(page, name):
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


CUR = {"page": None}


def add(page, product, qty):
    """Tap a product; products with add-ons open a small box where the quantity is set."""
    page.get_by_role("button").filter(has_text=product).first.click()
    dlg = page.get_by_role("dialog")
    if dlg.count():
        for _ in range(qty - 1):
            dlg.get_by_role("button", name="+", exact=True).click()
        dlg.get_by_role("button", name="Add to order").click()
    else:
        for _ in range(qty - 1):
            page.get_by_role("button").filter(has_text=product).first.click()


def step(name, fn):
    try:
        fn()
        print("  ✓", name)
    except Exception as e:  # noqa: BLE001
        problems.append(f"{name}: {str(e).splitlines()[0]}")
        lines = str(e).splitlines()
        print("  ✗", name, "\n   ", lines[0], "\n   ", next((l for l in lines if "waiting for" in l), ""))
        if CUR["page"]:
            CUR["page"].screenshot(path=f"{OUT}/FAIL-{name[:30].replace(' ', '_').replace(':', '')}.png", full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.add_init_script("window.print = () => {}; window.open = () => null;")
    watch(page, "admin")
    CUR["page"] = page
    login(page, "jj", "secret123")

    def partial_invoice():
        page.goto(BASE + "/orders/new")
        page.get_by_role("button", name="Account client").click()
        page.get_by_placeholder("Search name or phone").fill("City")
        page.get_by_role("button").filter(has_text="City Distributor").first.click()
        expect(page.get_by_text("Nothing owed").first).to_be_visible()
        add(page, "Turkey & Cheddar", 10)
        expect(page.get_by_text("Price list").first).to_be_visible()
        page.get_by_role("button", name="Next: payment").click()
        page.get_by_role("button", name="Cash", exact=True).click()
        page.fill("#paidnow", "10")
        expect(page.get_by_text("Rest on account")).to_be_visible()
        shot(page, "01-partial-invoice")
        page.get_by_role("button", name="Confirm order").click()
        expect(page.get_by_text("Order saved")).to_be_visible()
        shot(page, "02-order-saved")
        bal = next(c for c in api("GET", "/clients")["rows"] if c["name"] == "City Distributor")["balanceUsd"]
        assert abs(bal + 9) < 0.01, f"City Distributor balance {bal} (10 × 1.90 = 19, paid 10 → owes 9)"

    step("shop invoice paid in part, rest on the account", partial_invoice)

    def production():
        page.goto(BASE + "/production/new")
        card = page.locator("div.rounded-xl").filter(has_text="Turkey & Cheddar").first
        for _ in range(4):
            card.get_by_role("button", name="+").click()
        expect(page.get_by_text("Bread roll")).to_be_visible()
        shot(page, "03-production-preview")
        page.get_by_role("button", name="Confirm production").click()
        expect(page.get_by_text("is ready")).to_be_visible()
        shot(page, "04-production-done")

    step("morning production run", production)

    def client_return():
        page.goto(BASE + f"/clients/{clients['City Distributor']['id']}")
        page.get_by_role("button", name="Return").first.click()
        dialog = page.get_by_role("dialog")
        dialog.locator("#rt-o").select_option(index=1)
        page.wait_for_timeout(500)
        row = dialog.locator("div.grid").filter(has_text="Turkey & Cheddar").last
        row.get_by_role("button", name="+").click()
        shot(page, "05-return")
        dialog.get_by_role("button", name="Save return").click()
        expect(page.get_by_role("dialog")).to_have_count(0)
        bal = next(c for c in api("GET", "/clients")["rows"] if c["name"] == "City Distributor")["balanceUsd"]
        assert abs(bal + 7.1) < 0.01, f"balance after return {bal} (owes 9 − 1.90)"

    step("return from the client page", client_return)
    ctx.close()

    # Manager: simple screens
    ctx = b.new_context(viewport={"width": 1180, "height": 860})
    page = ctx.new_page()
    page.add_init_script("window.print = () => {}; window.open = () => null;")
    watch(page, "manager")
    CUR["page"] = page
    login(page, "rami", "pass1234")
    page.get_by_role("button", name="EN").click()

    def walk_in():
        page.goto(BASE + "/orders/new")
        page.get_by_role("button", name="Walk-in").first.click()
        add(page, "Lemon Mint", 1)
        add(page, "Halloumi & Tomato", 2)
        page.get_by_role("button", name="Next: payment").click()
        page.get_by_role("button", name="Cash", exact=True).click()
        page.get_by_role("button", name="Confirm order").click()
        expect(page.get_by_text("Order saved")).to_be_visible()
        shot(page, "06-manager-sale")

    step("manager: walk-in sale", walk_in)

    def close_day():
        page.goto(BASE + "/close")
        expected = api("GET", "/days/" + api("GET", "/reports/five")["date"])["mainBox"]["expected"]
        page.locator("input[inputmode=decimal], input[type=number]").first.fill(str(expected))
        shot(page, "07-close-count")
        page.get_by_role("button", name="Close the day").click()
        confirm = page.get_by_role("dialog")
        if confirm.count():
            confirm.get_by_role("button").last.click()
        expect(page.get_by_text("Closed").first).to_be_visible()
        shot(page, "08-day-closed")

    step("manager: count the box and close the day", close_day)
    ctx.close()
    b.close()

if problems:
    print("PROBLEMS:")
    for x in problems:
        print(" -", x)
    sys.exit(1)
print(f"All daily flows passed. Screenshots in {OUT}")
