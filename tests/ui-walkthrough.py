"""Browser walkthrough of Stage 1 (Playwright). Start the built app first:
   JJS_DATA_DIR=/tmp/jjs-ui PORT=4398 node dist/server/server/index.js
   python3 tests/ui-walkthrough.py http://127.0.0.1:4398 /tmp/shots
"""
import os
import sys

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4398"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/shots"
os.makedirs(OUT, exist_ok=True)
errors = []


def shot(page, name):
    page.wait_for_timeout(250)
    page.screenshot(path=f"{OUT}/{name}.png", full_page=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 860})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.on("console", lambda m: errors.append(f"console: {m.text}") if m.type == "error" else None)

    # 1. First-run setup (Arabic)
    page.goto(BASE)
    expect(page.get_by_role("heading", name="إعداد نظام JJ's")).to_be_visible()
    shot(page, "01-setup")
    page.fill("#setup-name", "جوزيف")
    page.fill("#setup-username", "jj")
    page.fill("#setup-password", "secret123")
    page.get_by_role("button", name="إنشاء حساب الإدارة والبدء").click()
    expect(page.get_by_role("heading", name="أهلاً جوزيف")).to_be_visible()
    shot(page, "02-admin-home")

    # 2. Users: create a manager and a member
    page.get_by_role("link", name="المستخدمون").first.click()
    for name, user, role in [("رامي", "rami", "المدير"), ("سامي", "sami", "موظف")]:
        page.get_by_role("button", name="مستخدم جديد").click()
        page.fill("#u-name", name)
        page.fill("#u-username", user)
        page.fill("#u-pass", "pass1234")
        page.select_option("#u-role", label=role)
        page.get_by_role("button", name="حفظ").click()
        expect(page.get_by_text(user, exact=True)).to_be_visible()
    shot(page, "03-users")

    # 3. Roles: grid + create a custom role
    page.get_by_role("link", name="الأدوار والصلاحيات").first.click()
    page.get_by_role("button", name="المدير").first.click()
    shot(page, "04-roles-manager")
    page.get_by_role("button", name="دور جديد").click()
    page.fill("#r-ar", "كاشير")
    page.fill("#r-en", "Cashier")
    page.get_by_label("الطلبات — عرض").check()
    page.get_by_label("الطلبات — إضافة").check()
    page.get_by_role("button", name="حفظ").click()
    expect(page.get_by_text("تم حفظ الدور.")).to_be_visible()

    # 4. Settings tabs
    page.get_by_role("link", name="الإعدادات").first.click()
    page.fill("#b-phone", "+963 944 000 000")
    page.get_by_role("button", name="حفظ").click()
    expect(page.get_by_text("تم الحفظ.").first).to_be_visible()
    shot(page, "05-settings-business")

    page.get_by_role("link", name="القوائم").click()
    page.fill("#l-ar", "بيستو")
    page.fill("#l-en", "Pesto")
    page.get_by_role("button", name="إضافة بند").click()
    expect(page.locator('input[value="Pesto"]')).to_be_visible()
    # "+ Add new" from inside a dropdown
    page.wait_for_timeout(600)  # the list preview reloads after adding
    page.locator("select").last.select_option("__add_new__")
    page.fill("#lk-ar", "جبنة شيدر")
    page.fill("#lk-en", "Cheddar")
    page.get_by_role("button", name="إضافة", exact=True).click()
    page.wait_for_timeout(500)
    chosen = page.locator("select").last.evaluate("s => s.options[s.selectedIndex].text")
    assert chosen == "جبنة شيدر", f"new item should be selected, got {chosen}"
    shot(page, "06-settings-lists")

    page.get_by_role("link", name="العملة وسعر الصرف").click()
    page.fill("#fx-manual", "117.5")
    page.get_by_role("button", name="اعتماد هذا السعر").click()
    expect(page.get_by_text("سعر يدوي").first).to_be_visible()
    shot(page, "07-settings-currency")

    page.get_by_role("link", name="الضرائب").click()
    page.get_by_role("button", name="ضريبة جديدة").click()
    page.fill("#t-ar", "رسم خدمة")
    page.fill("#t-en", "Service fee")
    page.fill("#t-val", "5")
    page.get_by_role("button", name="حفظ").click()
    expect(page.get_by_text("رسم خدمة")).to_be_visible()

    page.get_by_role("link", name="النسخ الاحتياطي").click()
    page.get_by_role("button", name="نسخ احتياطي الآن").click()
    expect(page.get_by_text("تم حفظ النسخة.")).to_be_visible()
    shot(page, "08-settings-backups")

    # 5. Audit log
    page.get_by_role("link", name="سجل العمليات").first.click()
    page.get_by_role("button", name="التفاصيل").first.click()
    shot(page, "09-audit")

    # 6. Future module placeholder
    page.get_by_role("link", name="الطلبات").first.click()
    expect(page.get_by_text("يأتي في المرحلة 6")).to_be_visible()

    # 7. English switch
    page.get_by_role("button", name="EN").click()
    page.get_by_role("link", name="Users").first.click()
    expect(page.get_by_role("heading", name="Users")).to_be_visible()
    shot(page, "10-users-en")

    # 8. Log out, log in as manager → simple mode
    page.get_by_role("button", name="ج").click() if page.get_by_role("button", name="ج").count() else page.locator("header button").last.click()
    page.get_by_role("button", name="Log out").click()
    page.fill("#login-user", "rami")
    page.fill("#login-pass", "wrong")
    page.get_by_role("button", name="Log in").click()
    expect(page.get_by_text("wrong")).to_be_visible()
    page.fill("#login-pass", "pass1234")
    page.get_by_role("button", name="Log in").click()
    page.wait_for_timeout(500)
    shot(page, "11-manager-home")
    assert page.get_by_role("link", name="المستخدمون").count() == 0, "manager must not see Users"
    page.goto(BASE + "/users")
    expect(page.get_by_text("دورك لا يسمح بهذه العملية.")).to_be_visible()

    # 9. Phone width
    m = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    m.on("pageerror", lambda e: errors.append(f"m pageerror: {e}"))
    m.goto(BASE)
    m.fill("#login-user", "sami")
    m.fill("#login-pass", "pass1234")
    m.get_by_role("button", name="دخول").click()
    m.wait_for_timeout(600)
    m.screenshot(path=f"{OUT}/12-member-phone.png", full_page=True)
    width = m.evaluate("document.documentElement.scrollWidth")
    assert width <= 390, f"phone page scrolls sideways ({width}px)"

    b.close()

real = [e for e in errors if "401" not in e]
print("console/page errors:", real or "none")
print("UI walkthrough passed.")
