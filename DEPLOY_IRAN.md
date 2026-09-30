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

در Preview، OTP و پرداخت در حالت Sandbox هستند. برای Production باید adapter شرکت پیامک و درگاه انتخابی به endpointهای آماده متصل شود. رازها را فقط در `.env` یا Secret Manager قرار دهید و وارد Git نکنید.

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
