"""Client portal click-through (Playwright), on a FRESH data folder:
   JJS_DATA_DIR=/tmp/jjs-portal PORT=4398 node dist/server/server/index.js &
   python3 tests/ui-portal.py http://127.0.0.1:4398 /tmp/portal

1. Admin creates a client in the app and gets the login card.
2. The client (phone size, Arabic) signs in, sets a password, orders with "pay on delivery".
3. The manager's bell rings; they accept from Client requests.
4. The client sees the order accepted; the order shows the Portal badge.
5. A second order is declined with a reason; the client sees the reason.
"""
import json
import os
import sys
import urllib.request

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4398"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/portal"
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
api("POST", "/users", {"name": "Rami", "username": "rami", "password": "pass1234", "language": "ar", "roleId": next(r["id"] for r in roles if r["systemKey"] == "manager")})
api("POST", "/clients/plans", {"nameAr": "باقة الغداء", "nameEn": "Lunch plan", "monthlyFee": 40, "currency": "USD", "discountPct": 10, "includedItems": 6})
api("POST", "/clients/plans", {"nameAr": "باقة المكتب", "nameEn": "Office plan", "monthlyFee": 90, "currency": "USD", "discountPct": 15, "includedItems": 15})


def watch(page, who):
    page.on("pageerror", lambda e: problems.append(f"[{who}] pageerror: {e}"))
    page.on("console", lambda m: problems.append(f"[{who}] console: {m.text}") if m.type == "error" and "401" not in m.text and "Failed to load resource" not in m.text else None)
    page.on("response", lambda r: problems.append(f"[{who}] {r.status} {r.url}") if r.status >= 500 else None)


def shot(page, name):
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


def add_product(page, name):
    """Tap + on a product; if it has add-ons, pick the required ones and add from the sheet."""
    page.locator("div.rounded-2xl").filter(has_text=name).first.get_by_role("button", name="أضف").click()
    page.wait_for_timeout(300)
    sheet = page.get_by_role("dialog")
    if sheet.count():
        for fs in sheet.locator("fieldset").all():
            if "مطلوب" in fs.locator("legend").inner_text():
                fs.get_by_role("button").first.click()
        sheet.get_by_role("button", name="أضف إلى السلة").click()


def step(name, fn):
    try:
        fn()
        print("  ✓", name)
    except Exception as e:  # noqa: BLE001
        problems.append(f"{name}: {e}")
        print("  ✗", name, "\n   ", str(e).splitlines()[0])


S = {}
with sync_playwright() as p:
    browser = p.chromium.launch()
    admin = browser.new_page(viewport={"width": 1280, "height": 860})
    watch(admin, "admin")
    phone_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    phone = phone_ctx.new_page()
    watch(phone, "client")
    mgr = browser.new_page(viewport={"width": 1280, "height": 860})
    watch(mgr, "manager")

    def admin_creates_client():
        admin.goto(BASE + "/")
        admin.fill("#login-user", "jj")
        admin.fill("#login-pass", "secret123")
        admin.keyboard.press("Enter")
        admin.wait_for_selector("header")
        admin.goto(BASE + "/clients")
        admin.get_by_role("button", name="+ New client").click()
        admin.fill("#c-name", "مقهى الياسمين")
        admin.fill("#c-phone", "0944123456")
        admin.get_by_role("button", name="Save").click()
        dlg = admin.get_by_role("dialog")
        expect(dlg.get_by_text("Client login ready")).to_be_visible()
        vals = dlg.locator(".font-mono").all_inner_texts()
        S["user"], S["pass"] = vals[1], vals[2]
        shot(admin, "01-admin-credentials")
        dlg.get_by_role("button", name="Done").click()
        expect(admin.get_by_role("tab", name="Client login")).to_have_attribute("aria-selected", "true")
        shot(admin, "02-admin-client-login-tab")

    def client_signs_in():
        phone.goto(BASE + "/portal")
        expect(phone.get_by_role("heading", name="تسجيل الدخول")).to_be_visible()
        shot(phone, "03-client-login")
        phone.fill("#p-user", S["user"])
        phone.fill("#p-pass", "wrong-one")
        phone.get_by_role("button", name="دخول").click()
        expect(phone.get_by_text("اسم المستخدم أو كلمة المرور غير صحيحة.")).to_be_visible()
        phone.fill("#p-pass", S["pass"])
        phone.get_by_role("button", name="دخول").click()
        expect(phone.get_by_text("اختر كلمة مرور خاصة بك لتبدأ.")).to_be_visible()
        shot(phone, "04-client-first-password")
        phone.fill("#cp-cur", S["pass"])
        phone.fill("#cp-new", "yasmin2026")
        phone.fill("#cp-again", "yasmin2026")
        phone.get_by_role("button", name="حفظ").click()
        expect(phone.get_by_text("لا ديون ✓")).to_be_visible()
        shot(phone, "05-client-home-empty")

    def client_orders():
        phone.get_by_role("link", name="اطلب", exact=True).click()
        expect(phone.get_by_role("heading", name="القائمة")).to_be_visible()
        # a sandwich with add-ons opens the options sheet
        phone.locator("div.rounded-2xl").filter(has_text="حبش وشيدر").first.get_by_role("button", name="أضف").click()
        sheet = phone.get_by_role("dialog")
        for fs in sheet.locator("fieldset").all():
            if "مطلوب" in fs.locator("legend").inner_text():
                fs.get_by_role("button").first.click()
        sheet.get_by_role("button", name="+", exact=True).click()
        shot(phone, "06a-client-options-sheet")
        sheet.get_by_role("button", name="أضف إلى السلة").click()
        add_product(phone, "ليمون ونعناع")
        expect(phone.get_by_role("button", name="عرض السلة")).to_be_visible()
        shot(phone, "06-client-menu-with-cart")
        phone.get_by_role("button", name="عرض السلة").click()
        sheet = phone.get_by_role("dialog")
        sheet.get_by_role("button", name="+", exact=True).last.click()
        sheet.get_by_role("button", name="توصيل").click()
        sheet.get_by_role("button", name="عند الاستلام").click()
        sheet.locator("textarea").fill("بدون بصل لو سمحت")
        expect(sheet.get_by_text("الإجمالي", exact=True)).to_be_visible()
        shot(phone, "07-client-checkout")
        sheet.get_by_role("button").filter(has_text="أرسل الطلب").click()
        expect(phone.get_by_text("تم إرسال طلبك!")).to_be_visible()
        shot(phone, "08-client-sent")
        phone.get_by_role("link", name="تابع الطلب").click()
        expect(phone.get_by_text("بانتظار موافقة المحل")).to_be_visible()
        shot(phone, "09-client-order-waiting")

    def manager_accepts():
        mgr.goto(BASE + "/")
        mgr.fill("#login-user", "rami")
        mgr.fill("#login-pass", "pass1234")
        mgr.keyboard.press("Enter")
        mgr.wait_for_selector("header")
        bell = mgr.get_by_role("button", name="الإشعارات")
        expect(bell).to_contain_text("1")
        bell.click()
        expect(mgr.get_by_text("طلب جديد من مقهى الياسمين")).to_be_visible()
        shot(mgr, "10-manager-bell")
        mgr.get_by_text("طلب جديد من مقهى الياسمين").click()
        expect(mgr.get_by_role("heading", name="طلبات الزبائن")).to_be_visible()
        expect(mgr.get_by_text("بدون بصل لو سمحت")).to_be_visible()
        expect(mgr.get_by_text("💵 الدفع عند الاستلام")).to_be_visible()
        shot(mgr, "11-manager-requests")
        mgr.get_by_role("button", name="✓ قبول").click()
        expect(mgr.get_by_text("لا طلبات بانتظار الرد 🎉")).to_be_visible()

    def client_sees_accepted():
        phone.reload()
        expect(phone.get_by_text("قبله المحل")).to_be_visible()
        shot(phone, "12-client-order-accepted")
        phone.get_by_role("button", name="الإشعارات").click()
        expect(phone.get_by_text("تم قبول طلبك #1 ✅")).to_be_visible()
        shot(phone, "13-client-notifications")

    def portal_badge_on_orders():
        mgr.goto(BASE + "/orders")
        expect(mgr.get_by_text("📱 من التطبيق").first).to_be_visible()
        shot(mgr, "14-manager-orders-portal-badge")

    def decline_flow():
        phone.goto(BASE + "/portal/order")
        add_product(phone, "ليمون ونعناع")
        phone.get_by_role("button", name="عرض السلة").click()
        phone.get_by_role("dialog").get_by_role("button").filter(has_text="أرسل الطلب").click()
        expect(phone.get_by_text("تم إرسال طلبك!")).to_be_visible()
        mgr.goto(BASE + "/requests")
        mgr.get_by_role("button", name="✕ رفض").click()
        dlg = mgr.get_by_role("dialog")
        dlg.get_by_role("button", name="نفدت الكمية اليوم").click()
        shot(mgr, "15-manager-decline")
        dlg.get_by_role("button", name="رفض الطلب").click()
        expect(mgr.get_by_text("لا طلبات بانتظار الرد 🎉")).to_be_visible()
        phone.goto(BASE + "/portal/orders")
        phone.get_by_role("link").filter(has_text="#2").click()
        expect(phone.get_by_text("نفدت الكمية اليوم")).to_be_visible()
        shot(phone, "16-client-declined")

    def subscription_flow():
        phone.goto(BASE + "/portal/subscription")
        phone.get_by_role("button").filter(has_text="باقة الغداء").click()
        shot(phone, "17-client-plan-sheet")
        phone.get_by_role("button", name="أرسل طلب الاشتراك").click()
        expect(phone.get_by_text("طلبك قيد المراجعة")).to_be_visible()
        mgr.goto(BASE + "/requests?tab=subscriptions")
        mgr.get_by_role("button", name="✓ قبول وتفعيل").click()
        expect(mgr.get_by_text("لا طلبات بانتظار الرد 🎉")).to_be_visible()
        phone.goto(BASE + "/portal")
        expect(phone.get_by_text("باقة الغداء").first).to_be_visible()
        shot(phone, "18-client-home-with-plan")
        phone.get_by_role("link", name="اشتراكي").click()
        shot(phone, "19-client-plan")

    def english_and_account():
        phone.goto(BASE + "/portal/account")
        phone.get_by_role("button", name="EN").click()
        expect(phone.get_by_role("button", name="Sign out")).to_be_visible()
        shot(phone, "20-client-account-en")
        phone.goto(BASE + "/portal")
        expect(phone.get_by_text("Latest orders")).to_be_visible()
        shot(phone, "21-client-home-en")

    step("admin creates a client and gets the login card", admin_creates_client)
    step("client signs in on a phone and sets a password", client_signs_in)
    step("client orders with delivery + pay on delivery", client_orders)
    step("manager's bell rings and they accept", manager_accepts)
    step("client sees the order accepted and the notification", client_sees_accepted)
    step("the order shows the portal badge", portal_badge_on_orders)
    step("a second order is declined with a reason", decline_flow)
    step("client requests a plan, manager accepts", subscription_flow)
    step("English and the account page", english_and_account)
    browser.close()

print()
if problems:
    print("Problems:")
    for x in problems:
        print(" -", x)
    sys.exit(1)
print("Portal click-through passed. Screenshots in", OUT)
