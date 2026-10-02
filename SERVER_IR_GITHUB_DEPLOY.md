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
git clone -b arena/01a0f43a-khodroto https://github.com/mrkhb-projects/khodroto.git khodroto
cd khodroto
npm ci
npm run build
mkdir -p data tmp
touch tmp/restart.txt
```

اگر مخزن خصوصی شد، از Deploy Key فقط‌خواندنی استفاده کنید؛ رمز GitHub یا Personal Access Token را داخل فایل‌ها نگذارید.

## ۶. استقرار خودکار از GitHub Actions

به‌دلیل محدودیت دسترسی Workflow در اتصال فعلی GitHub، قالب آماده زیر در پروژه قرار دارد. آن را از طریق رابط GitHub با نام `.github/workflows/deploy-server-ir.yml` ذخیره کنید:

```text
deploy/github-actions-server-ir.yml.example
```

در GitHub وارد مسیر زیر شوید:

```text
Repository → Settings → Secrets and variables → Actions → New repository secret
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

پس از تنظیم Secretها، هر Push روی شاخه `main` یا شاخه فعلی Arena مراحل زیر را خودکار اجرا می‌کند:

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
arena/01a0f43a-khodroto
```

Workflow فعلی همین شاخه و `main` را دنبال می‌کند. برای محیط تولید پایدار بهتر است پس از تأیید تغییرات، Pull Request را در `main` ادغام کنید و بعد Workflow را فقط روی `main` نگه دارید.

## ۸. اگر SSH ندارید

بدون SSH، انتشار کاملاً خودکار برنامه Node قابل اتکا نیست. دو راه دارید:

1. در cPanel از **Git Version Control** مخزن را Clone کنید، پس از هر تغییر Pull بزنید و Node App را Restart کنید؛ این روش نیمه‌دستی است.
2. از پشتیبانی Server.ir درخواست فعال‌سازی SSH و Setup Node.js App کنید.

FTP فقط برای نسخه استاتیک مناسب است و API، دیتابیس، ورود، مدیریت و جمع‌آوری دیوار را اجرا نمی‌کند.

## ۹. تست نهایی

پس از انتشار این آدرس‌ها را بررسی کنید:

```text
https://bidup.ir/
https://www.bidup.ir/
https://bidup.ir/api/integration/status
https://bidup.ir/khodroto-admin
```

خروجی `/api/integration/status` برای اتصال واقعی دیوار باید `connected: true` و `provider: web` داشته باشد. اگر سایت باز شد اما این مقدار false بود، مشکل از استقرار رابط نیست؛ دسترسی خروجی هاست به endpoint دیوار یا تنظیمات Node باید بررسی شود.
