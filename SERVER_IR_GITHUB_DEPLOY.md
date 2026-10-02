# اتصال دامنه bidup.ir و استقرار خودکار روی هاست Server.ir

این پروژه یک برنامه کامل Node.js/Express است، نه یک سایت استاتیک. آپلود پوشه `dist` به‌تنهایی کافی نیست؛ API، ورود، مدیریت، SQLite، جمع‌آوری دیوار و ابزارهای نمایشگاه به اجرای دائم `server.js` نیاز دارند.

## ۱. ابتدا امکانات هاست را بررسی کنید

در cPanel باید موارد زیر دیده شوند:

- **Setup Node.js App** یا **Application Manager**
- Node.js نسخه **22** (پروژه از `node:sqlite` استفاده می‌کند)
- **Terminal** یا دسترسی SSH
- امکان اجرای برنامه Node به‌صورت دائم با Passenger
- یک مسیر قابل‌نوشتن و پایدار برای پوشه `data`

اگر Node 22، SSH یا اجرای دائم Node در پلن رایگان فعال نیست، از پشتیبانی Server.ir بخواهید آن را فعال کند. بدون این موارد فقط نسخه استاتیک رابط کاربری اجرا می‌شود و امکانات اصلی کار نخواهند کرد.

## ۲. اتصال دامنه

در cPanel به بخش **Domains** بروید و این دو دامنه را اضافه کنید:

- `bidup.ir`
- `www.bidup.ir`

اگر DNS دامنه جای دیگری مدیریت می‌شود:

```text
A      @      IP هاست Server.ir
CNAME  www    bidup.ir
```

اگر Server.ir برای هاست NameServer اختصاصی داده است، می‌توانید به‌جای رکوردهای بالا NameServerهای دامنه را در پنل ثبت‌کننده دامنه تغییر دهید. فقط یکی از این دو روش را انجام دهید.

بعد از انتشار DNS، در cPanel بخش **SSL/TLS Status** یا **AutoSSL** را اجرا کنید تا هر دو دامنه HTTPS بگیرند.

## ۳. ساخت برنامه Node.js

در **Setup Node.js App**:

```text
Node version: 22
Application mode: Production
Application root: khodroto
Application URL: bidup.ir
Application startup file: server.js
```

Document Root نباید مستقیماً مخزن یا پوشه `data` باشد. cPanel/Passenger درخواست دامنه را به برنامه Node هدایت می‌کند.

## ۴. متغیرهای محیطی

این متغیرها را در صفحه Node App وارد کنید. مقادیر امنیتی را در GitHub یا فایل‌های عمومی قرار ندهید.

```dotenv
NODE_ENV=production
DIVAR_PROVIDER=web
DIVAR_API_BASE_URL=https://api.divar.ir
DIVAR_CACHE_TTL_MINUTES=10
DIVAR_CITY_BATCH_SIZE=40
DATABASE_FILE=data/khodroto.db
DIVAR_CACHE_FILE=data/divar-cache.json
ADMIN_PHONE=09xxxxxxxxx
ADMIN_PASSWORD=یک-رمز-تصادفی-حداقل-۱۲-کاراکتری
CREDENTIALS_ENCRYPTION_KEY=یک-کلید-تصادفی-طولانی
```

در cPanel معمولاً متغیر `PORT` توسط Passenger تعیین می‌شود؛ آن را دستی ثابت نکنید مگر پشتیبانی Server.ir مقدار مشخصی اعلام کرده باشد.

## ۵. بارگذاری اولیه با Git

اگر SSH فعال است:

```bash
cd ~
git clone https://github.com/mrkhb-projects/khodroto.git khodroto
cd khodroto
npm ci
npm run build
mkdir -p data tmp
touch tmp/restart.txt
```

اگر مخزن خصوصی شد، از Deploy Key فقط‌خواندنی استفاده کنید؛ رمز GitHub یا Personal Access Token را داخل فایل‌ها نگذارید.

## ۶. استقرار خودکار از GitHub Actions با FTP

به‌دلیل محدودیت مجوز `workflows` در اتصال فعلی GitHub، قالب آماده زیر در پروژه قرار دارد؛ همانند قالب SSH آن را از طریق رابط GitHub با نام `.github/workflows/deploy-server-ir-ftp.yml` ذخیره کنید:

```text
deploy/github-actions-server-ir-ftp.yml.example
```

در GitHub وارد مسیر `Actions → New workflow → set up a workflow yourself` شوید (یا در شاخه `main` فایل `.github/workflows/deploy-server-ir-ftp.yml` را بسازید) و محتوای فایل قالب را همان‌طور که هست کپی و Commit کنید. پس از ذخیره، با هر Push روی شاخه `main` یا شاخه فعلی Arena (یا اجرای دستی از تب Actions) فعال می‌شود.

چهار Secret زیر در مسیر `Repository → Settings → Secrets and variables → Actions` ساخته شده است:

| نام Secret | مقدار |
|---|---|
| `SERVER_IR_FTP_HOST` | نام میزبان یا IP سرور FTP هاست |
| `SERVER_IR_FTP_USERNAME` | نام کاربری FTP |
| `SERVER_IR_FTP_PASSWORD` | رمز عبور FTP |
| `SERVER_IR_FTP_PORT` | پورت FTP؛ معمولاً `21` |

هر اجرای Workflow این مراحل را طی می‌کند:

1. نصب وابستگی‌ها و اجرای تست‌ها؛ در صورت خطا انتشار متوقف می‌شود
2. Build تولید (`npm run build`) و ساخت پوشه `dist`
3. آماده‌سازی بسته انتشار در `deploy-out/` شامل `server.js`، `package.json`، `package-lock.json`، `src/`، `dist/` و `tmp/restart.txt`
4. آپلود تفاضیلی روی FTPS به مسیر `repositories/khodroto/`
5. Restart خودکار Passenger؛ چون `tmp/restart.txt` در هر اجرا با مهر زمانی تازه آپلود می‌شود و Passenger با تغییر زمان‌نامه آن برنامه Node را Restart می‌کند

### حفاظت از داده و تنظیمات تولید

- فقط محتوای `deploy-out/` آپلود می‌شود؛ پوشه `data` (دیتابیس SQLite و کش دیوار)، فایل `.env` و `node_modules` روی هاست نه آپلود و نه حذف می‌شوند.
- حالت پاک‌سازی (`dangerous-clean-slate`) خاموش است؛ اکشن فقط فایل‌هایی را حذف می‌کند که قبلاً خودش آپلود کرده و بعداً از مخزن حذف شده‌اند. فایل‌های موجود روی هاست که هرگز توسط Workflow آپلود نشده‌اند (مثل `data/` و `.env`) دست‌نخورده می‌مانند.

### نکته‌های مهم

- نصب پکیج‌ها روی هاست با FTP خودکار نیست؛ اگر `package.json` تغییر کرد، یک‌بار در cPanel از بخش **Setup Node.js App** دکمه **Run NPM Install** را بزنید.
- پروتکل پیش‌فرض `ftps` است. اگر فقط FTP ساده روی پورت ۲۱ کار می‌کند، مقدار `protocol` را به `ftp` تغییر دهید. اگر فقط SFTP روی پورت ۲۲ در دسترس است، این اکشن مناسب نیست و از نسخه SSH استفاده کنید (بخش ۸).
- گزینه `security: loose` رمزنگاری TLS را حفظ می‌کند ولی گواهی self-signed رایج روی هاست‌های اشتراکی را قبول می‌کند؛ اگر گواهی معتبر روی میزبان FTP دارید، `strict` کنید.
- مسیر `server-dir` نسبت به دایرکتوری ورود کاربر FTP است. حساب FTP این پروژه مستقیماً داخل ریشه برنامه (`~/repositories/khodroto`) وارد می‌شود، بنابراین مقدار درست `./` است؛ اگر حسابی ساختید که در Home اکانت cPanel وارد می‌شود، آن را به `repositories/khodroto/` تغییر دهید. راه تشخیص: اگر بعد از Deploy یک پوشه `repositories` داخل ریشه برنامه پیدا شد، یعنی مسیر اشتباه بوده و باید `./` باشد (پوشه اضافه را از File Manager پاک کنید)، و اگر فایل‌ها در هیچ‌کدام نیامدند، مقدار را برگردانید.
- در صفحه **Setup Node.js App** مقدار **Application startup file** باید `server.js` باشد، نه `app.js`؛ فایل `app.js` قالب پیش‌فرض cPanel است و اجرای برنامه را به‌هم می‌ریزد. پس از اصلاح، برنامه را **Restart** کنید. لاگ بوت در `stderr.log` داخل ریشه برنامه نوشته می‌شود و بهترین مرجع تشخیص است.

## ۶-ب. جایگزین SSH (در صورت فعال‌بودن SSH)

قالب آماده SSH/rsync در مسیر زیر قرار دارد و در صورت دسترسی SSH سریع‌تر و کامل‌تر است، چون `npm ci` هم روی هاست اجرا می‌کند:

```text
deploy/github-actions-server-ir.yml.example
```

این Secretها را بسازید:

| نام Secret | مقدار |
|---|---|
| `SERVER_IR_HOST` | IP یا نام میزبان SSH هاست |
| `SERVER_IR_PORT` | معمولاً `22` |
| `SERVER_IR_USER` | نام کاربری cPanel/SSH |
| `SERVER_IR_APP_PATH` | مسیر کامل برنامه، مانند `/home/USERNAME/khodroto` |
| `SERVER_IR_SSH_KEY` | کلید خصوصی Deploy Key |
| `SERVER_IR_KNOWN_HOSTS` | خروجی `ssh-keyscan -p 22 HOST`؛ اختیاری ولی توصیه‌شده |

### ساخت کلید Deploy

روی رایانه خودتان:

```bash
ssh-keygen -t ed25519 -C "github-deploy-bidup" -f bidup_deploy
```

- محتوای `bidup_deploy` را در Secret به نام `SERVER_IR_SSH_KEY` قرار دهید.
- محتوای `bidup_deploy.pub` را در cPanel بخش **SSH Access → Manage SSH Keys** وارد و Authorize کنید.
- کلید خصوصی را در چت، مخزن یا فایل سایت قرار ندهید.

پس از تنظیم Secretهای SSH و ذخیره قالب به‌عنوان `.github/workflows/deploy-server-ir.yml`، هر Push روی شاخه `main` مراحل زیر را خودکار اجرا می‌کند:

1. نصب وابستگی‌ها
2. اجرای تست‌ها
3. Build تولید
4. انتقال فایل‌ها با SSH/rsync
5. حفظ `.env` و پوشه `data`
6. نصب پکیج‌های تولید
7. Restart برنامه Node با Passenger

اگر تست یا Build خراب باشد، نسخه خراب روی سایت منتشر نمی‌شود.

## ۷. ارتباط این چت با سایت

این چت مستقیماً به cPanel وصل نمی‌شود. زنجیره صحیح به این صورت است:

```text
تغییر در Arena → Commit و Push به GitHub → GitHub Actions → هاست Server.ir → bidup.ir
```

کار این جلسه روی شاخه زیر ذخیره می‌شود:

```text
arena/01a0fd65-khodroto
```

Workflow فعلی همین شاخه و `main` را دنبال می‌کند. برای محیط تولید پایدار بهتر است پس از تأیید تغییرات، Pull Request را در `main` ادغام کنید و بعد Workflow را فقط روی `main` نگه دارید.

## ۸. استقرار بدون SSH

بدون SSH همان Workflow فعلی FTP پاسخ‌گوست؛ برنامه کامل Node (API، دیتابیس، ورود، مدیریت و جمع‌آوری دیوار) از مسیر `repositories/khodroto` توسط Passenger اجرا می‌شود و فقط نصب پکیج‌ها پس از تغییر `package.json` یک‌بار از cPanel انجام می‌شود.

برای تغییرات دستی نیز می‌توانید در cPanel از **Git Version Control** Pull بزنید و سپس Node App را Restart کنید؛ روش خودکار همان FTP است.

## ۹. تست نهایی

پس از انتشار این آدرس‌ها را بررسی کنید:

```text
https://bidup.ir/
https://www.bidup.ir/
https://bidup.ir/api/integration/status
https://bidup.ir/khodroto-admin
```

خروجی `/api/integration/status` برای اتصال واقعی دیوار باید `connected: true` و `provider: web` داشته باشد. اگر سایت باز شد اما این مقدار false بود، مشکل از استقرار رابط نیست؛ دسترسی خروجی هاست به endpoint دیوار یا تنظیمات Node باید بررسی شود.
