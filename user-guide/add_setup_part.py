"""Adds the "Setting up" part (online install, XP-236B printer, receipts) to both guides and updates
the parts that described the old desktop server. Safe to run again: it replaces its own part."""
import json
from pathlib import Path

HERE = Path(__file__).parent
SITE = "https://jjs.ahmad-zaven.io"


def shot(id_, callouts, size=None):
    s = {"id": id_, "frame": "plain", "callouts": [{"key": k, "label": v} for k, v in callouts]}
    if size:
        s["size"] = size
    return s


EN = {
    "part": {
        "id": "setup",
        "title": "Setting up",
        "audience": ["owner"],
        "intro": "Do this part once, on the first day, with the person who installs the system. It takes about 30 minutes.",
        "chapters": [
            {
                "id": "install",
                "title": "Put JJ's ERP on the shop computer",
                "intro": f"JJ's ERP lives online at `{SITE}`. Nothing needs to be installed from a USB: you open the address and install it as an app. Every update arrives by itself.",
                "tasks": [
                    {
                        "id": "install-app",
                        "title": "Install JJ's ERP on the computer",
                        "goal": "So staff open it from an icon, in its own window, like a normal program.",
                        "time": "2 min",
                        "before": ["Google Chrome or Microsoft Edge", "Internet in the shop", "The Admin username and password"],
                        "steps": [
                            "Open **Chrome**.",
                            f"In the address bar, type `{SITE}` and press `Enter`. The sign-in screen opens.",
                            "At the right end of the address bar, click the small **Install** icon (a screen with an arrow). If you don't see it, click the **⋮** menu → **Cast, save and share** → **Install page as app**.",
                            "Click **Install**.",
                            {
                                "text": "JJ's ERP opens in its own window, and an icon is added to the desktop and the Start menu.",
                                "tip": "Right-click the icon on the taskbar and choose **Pin to taskbar**, so it is always one click away.",
                            },
                        ],
                        "result": "Staff open **JJ's ERP** from the desktop icon and sign in.",
                        "note": "On a phone: open the same address in Chrome (Android) or Safari (iPhone) and choose **Add to Home Screen**.",
                    },
                    {
                        "id": "install-printer",
                        "title": "Install the XP-236B printer",
                        "goal": "Windows must know the printer before JJ's ERP can print on it.",
                        "time": "10 min",
                        "before": ["The Xprinter XP-236B, its power cable and USB cable", "Internet, to download the driver (or the driver CD/USB from the box)", "A receipt roll (80 mm) and a label roll"],
                        "steps": [
                            "Plug the printer into power and into the computer by USB. Turn it on.",
                            "In Chrome, open `https://www.xprintertech.com/download/xp-236b` (the official Xprinter site). Under **Drivers** → **Windows**, click **Download**.",
                            "Open the downloaded file. If it is a `.zip`, right-click it → **Extract All**, then open the folder.",
                            {"text": "Run the setup file inside. Choose **XP-236B** when it asks for the model, and finish the setup.", "tip": "If the printer came with a driver CD or USB, you can run the setup from it instead."},
                            "Open Windows **Settings** → **Bluetooth & devices** → **Printers & scanners**. The XP-236B is in the list.",
                            "Click it → **Printer properties** → **Print test page**.",
                        ],
                        "result": "The printer prints the Windows test page.",
                        "warning": "Download the driver only from `https://www.xprintertech.com/download/xp-236b` or the CD/USB in the box. Other driver websites are not official and can install unwanted software.",
                    },
                ],
            },
            {
                "id": "printing",
                "title": "Printer and receipts",
                "intro": "One XP-236B prints both the 80 mm receipts and the stickers. You only swap the roll. These settings are saved on each computer.",
                "tasks": [
                    {
                        "id": "printer-settings",
                        "title": "Set up the printer in JJ's ERP",
                        "goal": "Gives receipts and labels the right size for the XP-236B.",
                        "time": "3 min",
                        "steps": [
                            {
                                "text": "Go to **Settings** → **Printing**. In the first box, press [[preset]].",
                                "shot": shot("print-printer", [("preset", "**Use settings for this printer**"), ("size", "**Label size** — the size of your stickers"), ("invoice", "**Print test invoice**"), ("label", "**Print test label**")]),
                            },
                            "Under **Label size**, press the size of your sticker roll (for example **50×30**).",
                            {
                                "text": "Scroll down to **This computer**. Type the printer name exactly as it is in Windows in [[labelp]] and [[receiptp]].",
                                "shot": shot("print-computer", [("labelp", "**Labels & barcodes printer**"), ("receiptp", "**Invoices printer (thermal)**"), ("shared", "**Labels and invoices share one printer** — tick it"), ("auto", "**Print the invoice by itself after every sale**")]),
                            },
                            "Tick [[shared]], because it is one printer. Then press the roll that is in the printer now: **Labels** or **Receipts 80 mm**.",
                            "If you want a receipt after every sale without pressing anything, tick [[auto]].",
                            "Press **Save** at the bottom of the page.",
                        ],
                        "result": "Receipts and labels now open at the right size.",
                        "note": "In the print window: pick **XP-236B**, set **Margins** to **None**, and untick **Headers and footers**. Chrome remembers this after the first time.",
                        
                    },
                    {
                        "id": "centre-receipt",
                        "title": "Centre the receipt on the paper",
                        "goal": "The printer head prints a little narrower than the paper. This makes sure nothing is cut off at the sides.",
                        "time": "3 min",
                        "before": ["The receipt roll in the printer"],
                        "steps": [
                            "In **Settings** → **Printing**, press **Print test invoice**. The test receipt has a ruler with numbers across the top.",
                            "Look at the ruler on the paper. Find the first number printed fully on the left, and the last number printed fully on the right.",
                            {
                                "text": "Type them in [[first]] and [[last]], then press [[centre]].",
                                "shot": shot("print-centre", [("first", "**First number (left)**"), ("last", "**Last number (right)**"), ("centre", "**Centre it**")]),
                            },
                            "Press **Print test invoice** again and check that nothing is cut at the sides.",
                            "Press **Save**.",
                        ],
                        "result": "Every receipt is centred and fully printed.",
                        "tip": "For stickers, print a **test label**. If the print sits off the sticker, use the **Label: right / left** and **down / up** buttons (each press is half a millimetre), test again, then **Save**.",
                        "new_page": True,
                    },
                    {
                        "id": "swap-roll",
                        "title": "Swap between receipts and labels",
                        "goal": "JJ's ERP remembers which roll is in the printer and reminds you before printing on the wrong one.",
                        "time": "1 min",
                        "steps": [
                            {
                                "text": "When you print a receipt while the label roll is in (or the opposite), JJ's ERP shows *Swap the roll first*.",
                                "shot": shot("roll-swap", [("swapped", "**Swapped, print**")], size="small"),
                            },
                            "Open the printer, take out the roll, and put in the other one.",
                            "Close the cover and hold the **FEED** button until it beeps. The printer measures the new paper.",
                            "Press [[swapped]].",
                        ],
                        "result": "It prints, and JJ's ERP now knows which roll is in.",
                        "warning": "Always hold **FEED** after swapping. If you don't, the next print can start in the wrong place.",
                    },
                    {
                        "id": "receipt-setup",
                        "title": "Set up what the receipt shows",
                        "goal": "Your WhatsApp, your Instagram and a QR code that opens the receipt on the client's phone.",
                        "time": "3 min",
                        "steps": [
                            {
                                "text": "In **Settings** → **Printing**, go to the **Invoices** box.",
                                "shot": shot("print-invoices", [("wa", "**WhatsApp number on receipts**"), ("social", "**Line under the shop name** — for example your Instagram"), ("qr", "**Digital receipt QR**"), ("save", "**Save**")], size="tall"),
                            },
                            "Type the shop's WhatsApp number in [[wa]]. Leave it empty to use the shop phone.",
                            "Type a short line in [[social]], for example `Instagram @jjsdeli`.",
                            f"Keep [[qr]] ticked. In **Receipt link address**, type `{SITE}`.",
                            "Press [[save]].",
                            {
                                "text": "Print any receipt to check it. It shows the logo, the items, the total, a **PAID** stamp, a QR that opens this receipt online, and a QR to order on WhatsApp.",
                                "shot": shot("receipt", [], size="tall"),
                            },
                        ],
                        "result": "The client can scan the receipt to open it on their phone, save it or send it.",
                        "new_page": True,
                    },
                ],
            },
        ],
    },
    "start_intro": f"JJ's ERP works online at `{SITE}`. Everyone signs in with their own username, on the shop computer or on a phone.",
    "start_task": {
        "id": "start-shop",
        "title": "Open JJ's ERP",
        "goal": "The shop computer needs internet. There is nothing to start.",
        "time": "30 sec",
        "steps": [
            "Double-click **JJ's ERP** on the desktop (or click it on the taskbar).",
            {
                "text": f"If the icon is missing, open Chrome and go to `{SITE}`.",
                "tip": "On a phone, open the same address and choose **Add to Home Screen** once.",
            },
        ],
        "result": "The sign-in screen of JJ's ERP is open.",
        "note": "Closing the window does nothing to the shop: the data is safe on the server. Open it again to continue.",
    },
    "qr_start": {"action": "Open JJ's ERP", "how": f"Double-click **JJ's ERP** on the desktop, or open `{SITE}`"},
    "qr_swap": {"action": "Swap the printer roll", "how": "Swap the roll → hold **FEED** until it beeps → **Swapped, print**"},
    "faq": {
        0: {"q": "Does it need the internet?", "a": "Yes. JJ's ERP works online, so the shop computer and phones need internet. If the internet stops, write the sales on paper and enter them when it is back."},
        1: {"q": "I closed the JJ's ERP window. Is anything lost?", "a": "No. Everything is saved on the server as soon as you press a button. Open **JJ's ERP** again to continue."},
        "data": {"q": "Where is my data kept?", "a": "On the shop's online server. A copy is made every day; the owner can download one in **Settings** → **Backups**."},
    },
    "trouble": {
        0: {"problem": "JJ's ERP doesn't open or shows *This site can't be reached*", "cause": "No internet on this computer or phone.", "fix": "Check the Wi-Fi or the internet box. Open any other website to test, then open JJ's ERP again."},
        5: {"problem": "The receipt doesn't print, or is cut at the sides", "cause": "The printer is off, out of paper, the wrong roll is in, or the receipt is not centred.", "fix": "Check the printer and the roll, hold **FEED** until it beeps. To fix the sides, see *Centre the receipt on the paper*."},
    },
}

AR = {
    "part": {
        "id": "setup",
        "title": "التجهيز",
        "audience": ["owner"],
        "intro": "يُنفَّذ هذا القسم مرة واحدة في اليوم الأول، مع الشخص الذي يركّب النظام. يحتاج نحو 30 دقيقة.",
        "chapters": [
            {
                "id": "install",
                "title": "تثبيت JJ's ERP على كمبيوتر المحل",
                "intro": f"يعمل JJ's ERP على الإنترنت على العنوان `{SITE}`. لا حاجة لتثبيت شيء من فلاشة: افتح العنوان وثبّته كتطبيق. كل تحديث يصل وحده.",
                "tasks": [
                    {
                        "id": "install-app",
                        "title": "ثبّت JJ's ERP على الكمبيوتر",
                        "goal": "ليفتحه الموظفون من أيقونة، في نافذة خاصة، مثل أي برنامج.",
                        "time": "دقيقتان",
                        "before": ["متصفح Google Chrome أو Microsoft Edge", "إنترنت في المحل", "اسم مستخدم الإدارة وكلمة المرور"],
                        "steps": [
                            "افتح **Chrome**.",
                            f"في شريط العنوان اكتب `{SITE}` واضغط `Enter`. تظهر شاشة الدخول.",
                            "في آخر شريط العنوان، اضغط أيقونة **Install** الصغيرة (شاشة عليها سهم). إذا لم تظهر، اضغط القائمة **⋮** ← **Cast, save and share** ← **Install page as app**.",
                            "اضغط **Install** (تثبيت).",
                            {
                                "text": "يُفتح JJ's ERP في نافذة خاصة، وتُضاف أيقونته إلى سطح المكتب وقائمة ابدأ.",
                                "tip": "اضغط بالزر الأيمن على الأيقونة في شريط المهام واختر **Pin to taskbar** (تثبيت في شريط المهام)، ليبقى على بُعد ضغطة واحدة.",
                            },
                        ],
                        "result": "يفتح الموظفون **JJ's ERP** من أيقونة سطح المكتب ويسجّلون الدخول.",
                        "note": "على الموبايل: افتح العنوان نفسه في Chrome (أندرويد) أو Safari (آيفون) واختر **Add to Home Screen** (إضافة إلى الشاشة الرئيسية).",
                    },
                    {
                        "id": "install-printer",
                        "title": "ثبّت طابعة XP-236B",
                        "goal": "يجب أن يتعرّف ويندوز على الطابعة قبل أن يطبع عليها JJ's ERP.",
                        "time": "10 دقائق",
                        "before": ["طابعة Xprinter XP-236B مع كبل الكهرباء وكبل USB", "إنترنت لتنزيل التعريف (أو سي دي/فلاشة التعريف من العلبة)", "رول فواتير 80 مم ورول ملصقات"],
                        "steps": [
                            "وصّل الطابعة بالكهرباء وبالكمبيوتر عبر USB، ثم شغّلها.",
                            "في Chrome افتح `https://www.xprintertech.com/download/xp-236b` (موقع Xprinter الرسمي). تحت **Drivers** ← **Windows** اضغط **Download**.",
                            "افتح الملف الذي نزل. إذا كان `.zip`، اضغط عليه بالزر الأيمن ← **Extract All** (استخراج الكل)، ثم افتح المجلد.",
                            {"text": "شغّل ملف التثبيت الموجود داخله. اختر **XP-236B** عندما يسأل عن الموديل، وأكمل التثبيت.", "tip": "إذا جاءت مع الطابعة سي دي أو فلاشة تعريف، يمكنك التثبيت منها بدلاً من ذلك."},
                            "افتح **Settings** (إعدادات ويندوز) ← **Bluetooth & devices** ← **Printers & scanners**. ستجد XP-236B في القائمة.",
                            "اضغط عليها ← **Printer properties** ← **Print test page** (طباعة صفحة اختبار).",
                        ],
                        "result": "تطبع الطابعة صفحة اختبار ويندوز.",
                        "warning": "نزّل التعريف فقط من `https://www.xprintertech.com/download/xp-236b` أو من السي دي/الفلاشة الموجودة في العلبة. مواقع التعريفات الأخرى غير رسمية وقد تثبّت برامج غير مرغوبة.",
                    },
                ],
            },
            {
                "id": "printing",
                "title": "الطابعة والفواتير",
                "intro": "طابعة XP-236B واحدة تطبع فواتير 80 مم والملصقات معاً، وتبدّل الرول فقط. هذه الإعدادات تُحفظ على كل كمبيوتر.",
                "tasks": [
                    {
                        "id": "printer-settings",
                        "title": "اضبط الطابعة في JJ's ERP",
                        "goal": "لتخرج الفواتير والملصقات بالمقاس الصحيح لطابعة XP-236B.",
                        "time": "3 دقائق",
                        "steps": [
                            {
                                "text": "اذهب إلى **الإعدادات** ← **الطباعة**. في المربع الأول اضغط [[preset]].",
                                "shot": shot("print-printer", [("preset", "**اضبط الإعدادات لهالطابعة**"), ("size", "**حجم الملصق** — مقاس رول الملصقات عندك"), ("invoice", "**اطبع فاتورة تجربة**"), ("label", "**اطبع ملصق تجربة**")]),
                            },
                            "تحت **حجم الملصق:**، اضغط مقاس رول الملصقات (مثلاً **⁦50×30⁩**).",
                            {
                                "text": "انزل إلى مربع **هالكمبيوتر**. اكتب اسم الطابعة كما هو في ويندوز تماماً في [[labelp]] و[[receiptp]].",
                                "shot": shot("print-computer", [("labelp", "**طابعة الملصقات والباركود**"), ("receiptp", "**طابعة الفواتير (حراري)**"), ("shared", "**الملصقات والفواتير على نفس الطابعة** — علّمها"), ("auto", "**اطبع الفاتورة لحالها بعد كل بيعة**")]),
                            },
                            "علّم [[shared]] لأنها طابعة واحدة. ثم اضغط الرول الموجود في الطابعة الآن: **ملصقات** أو **فواتير 80 ملم**.",
                            "إذا أردت أن تُطبع الفاتورة بعد كل بيعة بدون أي ضغطة، علّم [[auto]].",
                            "اضغط **حفظ** أسفل الصفحة.",
                        ],
                        "result": "تُفتح الفواتير والملصقات الآن بالمقاس الصحيح.",
                        "note": "في نافذة الطباعة: اختر **XP-236B**، واجعل **Margins** (الهوامش) **None** (بلا)، وأزل علامة **Headers and footers**. يتذكّر Chrome ذلك بعد المرة الأولى.",
                        
                    },
                    {
                        "id": "centre-receipt",
                        "title": "وسّط الفاتورة على الورق",
                        "goal": "رأس الطابعة يطبع أضيق قليلاً من الورق. هذه الخطوة تضمن ألّا ينقطع شيء من الجانبين.",
                        "time": "3 دقائق",
                        "before": ["رول الفواتير في الطابعة"],
                        "steps": [
                            "في **الإعدادات** ← **الطباعة**، اضغط **اطبع فاتورة تجربة**. في أعلى فاتورة التجربة مسطرة عليها أرقام.",
                            "انظر إلى المسطرة على الورق. حدّد أول رقم مطبوع كاملاً على اليسار، وآخر رقم مطبوع كاملاً على اليمين.",
                            {
                                "text": "اكتبهما في [[first]] و[[last]]، ثم اضغط [[centre]].",
                                "shot": shot("print-centre", [("first", "**أول رقم (يسار)**"), ("last", "**آخر رقم (يمين)**"), ("centre", "**وسّطها**")]),
                            },
                            "اضغط **اطبع فاتورة تجربة** مرة أخرى وتأكد أن لا شيء مقطوع من الجانبين.",
                            "اضغط **حفظ**.",
                        ],
                        "result": "كل فاتورة تُطبع في المنتصف وكاملة.",
                        "tip": "للملصقات: اطبع **ملصق تجربة**. إذا خرجت الطباعة عن الملصق، استعمل أزرار **الملصق: يمين / يسار** و**تحت / فوق** (كل ضغطة نصف ملّيمتر)، جرّب مرة أخرى، ثم **حفظ**.",
                        "new_page": True,
                    },
                    {
                        "id": "swap-roll",
                        "title": "التبديل بين الفواتير والملصقات",
                        "goal": "يتذكّر JJ's ERP أي رول في الطابعة، وينبّهك قبل الطباعة على الرول الخطأ.",
                        "time": "دقيقة",
                        "steps": [
                            {
                                "text": "إذا طبعت فاتورة ورول الملصقات في الطابعة (أو العكس)، يظهر في JJ's ERP *بدّل الرول أولاً*.",
                                "shot": shot("roll-swap", [("swapped", "**بدّلت، اطبع**")], size="small"),
                            },
                            "افتح الطابعة، أخرج الرول، وضع الرول الآخر.",
                            "أغلق الغطاء واضغط مطوّلاً على زر **FEED** حتى تُصدر صوتاً. الطابعة تقيس الورق الجديد.",
                            "اضغط [[swapped]].",
                        ],
                        "result": "تتم الطباعة، ويعرف JJ's ERP الآن أي رول في الطابعة.",
                        "warning": "اضغط **FEED** دائماً بعد التبديل. إن لم تفعل، قد تبدأ الطباعة التالية في المكان الخطأ.",
                    },
                    {
                        "id": "receipt-setup",
                        "title": "اختر ما يظهر على الفاتورة",
                        "goal": "رقم الواتساب، حساب الإنستغرام، وكود QR يفتح الفاتورة على موبايل الزبون.",
                        "time": "3 دقائق",
                        "steps": [
                            {
                                "text": "في **الإعدادات** ← **الطباعة**، اذهب إلى مربع **الفواتير**.",
                                "shot": shot("print-invoices", [("wa", "**رقم الواتساب على الفاتورة**"), ("social", "**سطر تحت اسم المحل** — مثلاً حساب الإنستغرام"), ("qr", "**كود QR فاتورتك أونلاين**"), ("save", "**حفظ**")], size="tall"),
                            },
                            "اكتب رقم واتساب المحل في [[wa]]. اتركه فارغاً ليُستعمل رقم هاتف المحل.",
                            "اكتب سطراً قصيراً في [[social]]، مثلاً `Instagram @jjsdeli`.",
                            f"أبقِ [[qr]] معلَّماً. وفي **عنوان روابط الفواتير** اكتب `{SITE}`.",
                            "اضغط [[save]].",
                            {
                                "text": "اطبع أي فاتورة للتأكد. تظهر عليها: اللوغو، الأصناف، المجموع، ختم **مدفوعة**، كود QR يفتح الفاتورة أونلاين، وكود QR للطلب عبر واتساب.",
                                "shot": shot("receipt", [], size="tall"),
                            },
                        ],
                        "result": "يمسح الزبون الكود ليفتح الفاتورة على موبايله، يحفظها أو يرسلها.",
                        "new_page": True,
                    },
                ],
            },
        ],
    },
    "start_intro": f"يعمل JJ's ERP على الإنترنت على العنوان `{SITE}`. كل شخص يدخل باسم المستخدم الخاص به، من كمبيوتر المحل أو من الموبايل.",
    "start_task": {
        "id": "start-shop",
        "title": "افتح JJ's ERP",
        "goal": "كمبيوتر المحل يحتاج إنترنت. لا يوجد شيء لتشغيله.",
        "time": "30 ثانية",
        "steps": [
            "اضغط مرتين على **JJ's ERP** على سطح المكتب (أو اضغطه في شريط المهام).",
            {
                "text": f"إذا لم تجد الأيقونة، افتح Chrome واذهب إلى `{SITE}`.",
                "tip": "على الموبايل، افتح العنوان نفسه واختر **Add to Home Screen** مرة واحدة.",
            },
        ],
        "result": "تظهر شاشة الدخول إلى JJ's ERP.",
        "note": "إغلاق النافذة لا يؤثر على المحل: البيانات محفوظة على السيرفر. افتحه من جديد لتكمل.",
    },
    "qr_start": {"action": "فتح JJ's ERP", "how": f"اضغط مرتين على **JJ's ERP** على سطح المكتب، أو افتح `{SITE}`"},
    "qr_swap": {"action": "تبديل رول الطابعة", "how": "بدّل الرول ← اضغط **FEED** حتى تُصدر صوتاً ← **بدّلت، اطبع**"},
    "faq": {
        0: {"q": "هل يحتاج النظام إلى إنترنت؟", "a": "نعم. يعمل JJ's ERP على الإنترنت، لذلك يحتاج كمبيوتر المحل والموبايلات إلى إنترنت. إذا انقطع الإنترنت، اكتب المبيعات على ورقة وأدخلها عند عودته."},
        1: {"q": "أغلقت نافذة JJ's ERP. هل ضاع شيء؟", "a": "لا. كل شيء يُحفظ على السيرفر فور ضغط الزر. افتح **JJ's ERP** من جديد لتكمل."},
        "data": {"q": "أين تُحفظ البيانات؟", "a": "على سيرفر المحل على الإنترنت. تُؤخذ نسخة كل يوم، ويستطيع صاحب المحل تنزيل نسخة من **الإعدادات** ← **النسخ الاحتياطي**."},
    },
    "trouble": {
        0: {"problem": "JJ's ERP لا يفتح أو يظهر *This site can't be reached*", "cause": "لا يوجد إنترنت على هذا الكمبيوتر أو الموبايل.", "fix": "افحص الواي فاي أو راوتر الإنترنت. افتح أي موقع آخر للتجربة، ثم افتح JJ's ERP من جديد."},
        5: {"problem": "الفاتورة لا تُطبع، أو مقطوعة من الجانبين", "cause": "الطابعة مطفأة، أو الورق انتهى، أو الرول الخطأ في الطابعة، أو الفاتورة غير موسّطة.", "fix": "افحص الطابعة والرول، واضغط **FEED** حتى تُصدر صوتاً. لإصلاح الجانبين راجع *وسّط الفاتورة على الورق*."},
    },
}


def unlink_keys(part):
    """[[key]] only works in the step that has the screenshot; elsewhere write the bold label."""
    import re
    for ch in part["chapters"]:
        for task in ch["tasks"]:
            labels = {}
            for st in task["steps"]:
                if isinstance(st, dict) and "shot" in st:
                    for c in st["shot"]["callouts"]:
                        labels[c["key"]] = re.match(r"\*\*[^*]+\*\*", c["label"]).group(0)
            for i, st in enumerate(task["steps"]):
                if isinstance(st, str):
                    task["steps"][i] = re.sub(r"\[\[(\w+)\]\]", lambda m: labels.get(m.group(1), m.group(0)), st)


def rtl_arrows(x):
    """Arabic: mark each arrow right-to-left, so two English button names around it keep their order."""
    if isinstance(x, str):
        return x.replace(" ← ", " ‏←‏ ")
    if isinstance(x, list):
        return [rtl_arrows(v) for v in x]
    if isinstance(x, dict):
        return {k: rtl_arrows(v) for k, v in x.items()}
    return x


def apply(path, t):
    unlink_keys(t["part"])
    if t is AR:
        t = {k: rtl_arrows(v) for k, v in t.items()}
    g = json.loads(path.read_text(encoding="utf-8"))
    g["parts"] = [p for p in g["parts"] if p.get("id") != "setup"]
    g["parts"].insert(0, t["part"])
    start = next(c for p in g["parts"] for c in p.get("chapters", []) if c.get("id") == "start")
    start["intro"] = t["start_intro"]
    start["tasks"] = [t["start_task"] if x["id"] == "start-shop" else x for x in start["tasks"]]
    qr = g["quick_reference"]
    i = next(i for i, r in enumerate(qr) if "Server" in r.get("how", "") or r.get("action") == t["qr_start"]["action"])
    qr[i] = t["qr_start"]
    if not any(r.get("action") == t["qr_swap"]["action"] for r in qr):
        qr.insert(i + 1, t["qr_swap"])
    for k, v in t["faq"].items():
        if k == "data":
            j = next(j for j, f in enumerate(g["faq"]) if "APPDATA" in f["a"] or f["q"] == v["q"])
            g["faq"][j] = v
        else:
            g["faq"][k] = v
    for k, v in t["trouble"].items():
        g["troubleshooting"][k] = v
    g["meta"]["date"] = "November 2026" if path.name.endswith("en.json") else "تشرين الثاني 2026"
    g["meta"]["version"] = "1.1"
    path.write_text(json.dumps(g, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("updated", path.name)


apply(HERE / "guide.en.json", EN)
apply(HERE / "guide.ar.json", AR)
