# استقرار خودروتو روی هاست ایران

## نوع هاست موردنیاز

هاست اشتراکی PHP برای خودروتو مناسب نیست. یکی از این گزینه‌ها لازم است:

- VPS ایران با Ubuntu 22/24 و حداقل ۲ هسته، ۴ گیگ RAM و ۳۰ گیگ SSD
- سرویس ابری ایرانی دارای Docker و Persistent Volume
- هاست Node.js که Node 22، اجرای دائم Process و فضای دیسک پایدار ارائه کند

برای شروع، Docker روی VPS ایران ساده‌ترین روش است.

## نصب با Docker

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
git clone YOUR_REPOSITORY_URL /opt/khodroto
cd /opt/khodroto
cp .env.example .env
nano .env
```

حداقل تنظیمات `.env`:

```dotenv
NODE_ENV=production
PORT=5173
DIVAR_PROVIDER=web
DIVAR_API_BASE_URL=https://api.divar.ir
DIVAR_CITY_IDS=1
DIVAR_WEB_CATEGORY=light
DIVAR_MAX_PAGES=0
DIVAR_HARD_MAX_PAGES=500
DIVAR_CACHE_TTL_MINUTES=10
DATABASE_FILE=data/khodroto.db
ADMIN_PHONE=09xxxxxxxxx
# حداقل ۳۲ کاراکتر تصادفی؛ پس از ذخیره اعتبارنامه‌ها تغییر ندهید.
CREDENTIALS_ENCRYPTION_KEY=replace-with-a-long-random-secret
```

سپس:

```bash
docker compose up -d --build
docker compose logs -f khodroto
```

## دامنه و SSL

فایل `deploy/nginx.conf` را کپی و دامنه را جایگزین کنید:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/khodroto
sudo ln -s /etc/nginx/sites-available/khodroto /etc/nginx/sites-enabled/khodroto
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d example.ir -d www.example.ir
```

## ساخت مدیر

1. مقدار `ADMIN_PHONE` را شماره خودتان قرار دهید.
2. کانتینر را Restart کنید: `docker compose restart khodroto`.
3. از دکمه ورود سایت با همان شماره وارد شوید.
4. مسیر `/admin` را باز کنید.

پنل مدیریت شامل نمای کلی، کاربران، نقش‌ها، اشتراک‌ها، تیکت‌ها، آگهی‌ها، سلامت collector، اجرای دستی جمع‌آوری و تنظیمات عمومی است.

## پیامک و پرداخت

در بخش تنظیمات مدیریت می‌توان هر تعداد درگاه پرداخت و پنل پیامکی را ثبت، ویرایش، اولویت‌بندی و به‌صورت هم‌زمان فعال کرد. اطلاعات محرمانه در پاسخ API برگردانده نمی‌شوند و با AES-256-GCM در SQLite رمز می‌شوند. متغیر `CREDENTIALS_ENCRYPTION_KEY` را پیش از ثبت اولین اتصال تنظیم و سپس در Secret Manager یا نسخه پشتیبان امن نگهداری کنید؛ تغییر یا گم‌شدن آن باعث غیرقابل‌خواندن‌شدن کلیدهای ذخیره‌شده می‌شود.

درگاه‌های فعال در صفحه خرید به کاربر پیشنهاد می‌شوند. برای ارسال واقعی OTP یا انتقال واقعی پرداخت، adapter سمت سرور ارائه‌دهنده انتخابی باید به API همان شرکت متصل شود؛ تا پیش از آن Preview در حالت Sandbox باقی می‌ماند. رازها را در Git، فرانت‌اند یا لاگ قرار ندهید.

## بکاپ

داده‌ها در Volume داکر ذخیره می‌شوند. روزانه از این موارد بکاپ بگیرید:

- `data/khodroto.db`
- `data/khodroto.db-wal`
- `data/divar-cache.json`
- فایل `.env` در محل رمزگذاری‌شده

برای ترافیک زیاد، SQLite را به PostgreSQL و صف محلی را به Redis/BullMQ مهاجرت دهید.

## به‌روزرسانی

```bash
cd /opt/khodroto
git pull
docker compose up -d --build
```
