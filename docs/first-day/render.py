# Render the first-day sheet to PDF (A4, Arabic page + English page).
#   python docs/first-day/render.py
from pathlib import Path
from playwright.sync_api import sync_playwright

here = Path(__file__).resolve().parent
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.goto((here / "first-day-sheet.html").as_uri(), wait_until="networkidle")
    pg.evaluate("document.fonts.ready")
    pg.pdf(path=str(here / "JJs-first-day-sheet.pdf"), format="A4", print_background=True, prefer_css_page_size=True)
    pg.set_viewport_size({"width": 794, "height": 1123})
    pg.screenshot(path=str(here / "preview-ar.png"), clip={"x": 0, "y": 0, "width": 794, "height": 1123})
    b.close()
print("wrote", here / "JJs-first-day-sheet.pdf")
