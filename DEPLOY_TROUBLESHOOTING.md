# چرا تغییرات روی bidup.ir دیده نمی‌شود؟ (عیب‌یابی دیپلوی)

تاریخ بررسی: ۲۰۲۶-۱۰-۰۳ — بعد از merge شدن PR #6 (کامیت `a1799d2` روی `main`، مرج‌کامیت `13e0eb9`).

---

## ۱) خلاصه‌ی نتیجه

کد روی گیت‌هاب **درست و کامل** مرج شده است. مشکل در **کد** نیست، در **رسیدن کد به هاست** است.
سرور `bidup.ir` بالا و سالم است ولی هنوز **نسخه‌ی قدیمی** را اجرا می‌کند.

شواهد اندازه‌گیری‌شده روی سایت زنده:

| بررسی | انتظار بعد از دیپلوی | چیزی که الان برمی‌گردد |
| --- | --- | --- |
| `GET /api/subscription/discount?code=TEST&plan=pro` | پاسخ JSON اعتبارسنجی تخفیف | `{"error":"NOT_FOUND"}` ← مسیر جدید وجود ندارد |
| `GET /assets/index-1byGsUUO.js` (باندل جدید) | فایل جاوااسکریپت | صفحه‌ی ۴۰۴ |
| `GET /api/health` | پاسخ می‌دهد | پاسخ می‌دهد ✅ (سرور بالاست) |

**نکته‌ی کلیدی برای عیب‌یابی:** فایل باندل جدید (`/assets/index-1byGsUUO.js`) هم ۴۰۴ می‌دهد.
فایل‌های `dist/` را حتی پروسه‌ی قدیمی Node هم به‌صورت استاتیک سرو می‌کند؛ پس اگر فقط
**ری‌استارت** انجام نشده بود، این فایل باید پیدا می‌شد.
۴۰۴ بودن آن یعنی: **فایل‌ها اصلاً روی هاست آپلود نشده‌اند.**
یعنی مشکل در مرحله‌ی FTP اکشن است، نه در ری‌استارت Passenger.

---

## ۲) مسیر دیپلوی این پروژه (یادآوری)

فایل `.github/workflows/deploy-server-ir-ftp.yml`:

1. تریگر: هر `push` روی `main` (یا اجرای دستی `workflow_dispatch`)
2. `Verify FTP secrets exist` → اگر سکرت‌ها نباشند، همین‌جا fail می‌کند
3. `npm ci` → `npm test` → `npm run build`
4. ساخت `deploy-out/` شامل: `server.js`, `app.js`, `package.json`, `package-lock.json`, `src/`, `dist/`, `tmp/restart.txt`
5. `Detect FTP application directory` → تشخیص `./` یا `repositories/khodroto/`
6. آپلود با `SamKirkland/FTP-Deploy-Action@v4.3.5` (پروتکل `ftps`، `security: loose`)
7. تغییر `tmp/restart.txt` → Passenger اپ را ری‌استارت می‌کند

---

## ۳) محتمل‌ترین علت‌ها، به ترتیب احتمال

### الف) اکشن به‌خاطر `concurrency` در صف گیر کرده است

```yaml
concurrency:
  group: server-ir-ftp-deploy
  cancel-in-progress: false
```

اگر اجرای قبلی (مثلاً اجرای مربوط به PR #5) روی مرحله‌ی FTP **هنگ کرده یا هنوز تمام نشده**،
اجرای جدید **اجرا نمی‌شود و بی‌صدا در صف می‌ماند** تا قبلی تمام شود.
در تب Actions چنین اجرایی با وضعیت زرد/«Queued» یا «Waiting» دیده می‌شود.

**رفع:** اجرای قدیمیِ گیرکرده را Cancel کنید، بعد اجرای جدید را Re-run کنید.

### ب) مرحله‌ی FTP شکست خورده است

شایع‌ترین دلایل روی هاست‌های اشتراکی ایران:

- سکرت‌های `SERVER_IR_FTP_HOST` / `USERNAME` / `PASSWORD` / `PORT` تنظیم نشده یا منقضی شده‌اند
- فایروال هاست، IP رانرهای گیت‌هاب (خارج از ایران) را بلاک می‌کند → timeout در اتصال FTP
- محدودیت FTP passive port روی هاست
- تغییر پسورد اکانت FTP در cPanel

### ج) آپلود در مسیر اشتباه انجام شده

مرحله‌ی `Detect FTP application directory` بین `./` و `repositories/khodroto/` تصمیم می‌گیرد.
اگر اکانت FTP در جای دیگری login کند (مثلاً `public_html`)، فایل‌ها آپلود **می‌شوند** ولی
در پوشه‌ای که Passenger از آن اجرا نمی‌کند → سایت تغییری نمی‌کند.
در لاگ اکشن خطِ `Selected FTP server-dir: ...` را ببینید؛ باید مسیر ریشه‌ی اپ باشد.

### د) اکشن اصلاً تریگر نشده

اگر Actions روی ریپو غیرفعال شده باشد یا بودجه‌ی Actions تمام شده باشد.

---

## ۴) کاری که باید انجام دهید (به ترتیب)

### گام ۱ — وضعیت اکشن را ببینید

https://github.com/mrkhb-projects/khodroto/actions

دنبال اجرای `Deploy to Server.ir (FTP)` برای کامیت `13e0eb9` بگردید و رنگش را ببینید:

- 🟡 **زرد / Queued** → علت «الف». اجرای قدیمی را Cancel کنید.
- 🔴 **قرمز / Failed** → روی اجرا کلیک کنید و ببینید کدام step قرمز است:
  - `Verify FTP secrets exist` → سکرت‌ها را در
    Settings → Secrets and variables → Actions دوباره وارد کنید
  - `Upload application over FTP` → علت «ب»؛ متن خطا را بفرستید
- ⚪️ **اصلاً اجرایی نیست** → علت «د»؛ از تب Actions دکمه‌ی
  **Run workflow** را روی `main` بزنید (چون `workflow_dispatch` فعال است)

### گام ۲ — راه میان‌بر: دیپلوی دستی از خود هاست

اگر SSH یا Terminal در cPanel دارید، سریع‌ترین راه دور زدن کل FTP این است:

```bash
cd ~/repositories/khodroto     # یا هر مسیری که Application root است
git fetch origin
git reset --hard origin/main
npm ci
npm run build
mkdir -p tmp && touch tmp/restart.txt
```

`touch tmp/restart.txt` باعث ری‌استارت Passenger می‌شود.

### گام ۳ — متغیرهای محیطی جدید را اضافه کنید

این آپدیت سه متغیر جدید معرفی کرده است. در cPanel → Setup Node.js App → Environment Variables
(یا در `data/.env` هاست) اضافه کنید:

```dotenv
STARTUP_WARM=true
STARTUP_WARM_DELAY_MS=60000
MARKET_REFRESH_INTERVAL_MINUTES=10
```

بدون این‌ها سایت کار می‌کند ولی گرم‌کردن تأخیری و رفرش دوره‌ای بازار مقدار پیش‌فرض می‌گیرد.

### گام ۴ — تأیید نهایی

بعد از دیپلوی، این دو آدرس را باز کنید:

```text
https://bidup.ir/api/subscription/discount?code=TEST&plan=pro
```
باید چیزی غیر از `NOT_FOUND` برگرداند (مثلاً خطای «کد نامعتبر») → یعنی سرور جدید بالا آمده.

```text
https://bidup.ir/assets/index-1byGsUUO.js
```
باید فایل جاوااسکریپت برگرداند، نه صفحه‌ی ۴۰۴ → یعنی باندل جدید روی هاست هست.

---

## ۵) نکته‌ی کش مرورگر

بعد از اینکه دو تست بالا سبز شد، اگر هنوز رابط کاربری قدیمی می‌بینید:

- یک‌بار **Hard Reload** بزنید (Ctrl+Shift+R یا Cmd+Shift+R)
- یا صفحه را در پنجره‌ی ناشناس (Incognito) باز کنید

در همین آپدیت هدرهای کش اصلاح شده است تا این مشکل تکرار نشود:

- `/assets/*` → `public, max-age=31536000, immutable` (نام فایل‌ها هش دارد، پس امن است)
- `index.html` → `no-cache` (همیشه از سرور تازه گرفته می‌شود)

یعنی از دیپلوی **بعدی** به بعد، دیگر لازم نیست کاربران کش را دستی پاک کنند.

---

## ۶) خلاصه در یک خط

کد سالم و مرج‌شده است؛ فایل‌های جدید هرگز به هاست نرسیده‌اند.
ابتدا وضعیت اکشن `Deploy to Server.ir (FTP)` را در تب Actions چک کنید؛
اگر در صف گیر کرده Cancel/Re-run کنید، اگر FTP قرمز است سکرت‌ها و دسترسی FTP را بررسی کنید،
و اگر عجله دارید با گام ۲ مستقیماً از روی هاست دیپلوی کنید.
