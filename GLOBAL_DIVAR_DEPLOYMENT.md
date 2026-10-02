# معماری اتصال مستقیم دیوار با دسترسی جهانی سایت

این معماری از «کنار» استفاده نمی‌کند. مرورگر کاربران داخل و خارج ایران فقط با برنامه اصلی تماس می‌گیرد؛ برنامه اصلی درخواست‌های سروری خود را از طریق یک رله خصوصی در ایران به endpointهای وب دیوار می‌فرستد.

```text
کاربر در هر کشور
       │ HTTPS
       ▼
برنامه اصلی روی Render / میزبان جهانی
       │ HTTPS + x-khodroto-relay-token
       ▼
رله خصوصی روی سرور ایران
       │ HTTPS
       ▼
api.divar.ir
```

در frontend هیچ آدرس localhost، آدرس دیوار یا توکن رله قرار نمی‌گیرد. بنابراین سایت برای کاربر خارجی باز می‌شود و فقط مسیر جمع‌آوری داده دارای خروجی ایران است.

## بخش اول: رله ایران

نیازمندی‌ها:

- یک VPS یا سرویس Docker در ایران
- یک زیردامنه مانند `relay.example.ir`
- دسترسی HTTPS معتبر

روی سرور ایران:

```bash
git clone YOUR_REPOSITORY_URL /opt/khodroto
cd /opt/khodroto
printf 'DIVAR_RELAY_TOKEN=%s\n' "$(openssl rand -hex 32)" > .env
cat .env
sudo docker compose -f docker-compose.relay.yml up -d --build
sudo docker compose -f docker-compose.relay.yml logs -f
```

فایل `deploy/relay-nginx.conf` را در Nginx قرار دهید، `relay.example.ir` را با دامنه واقعی عوض کنید و SSL بگیرید:

```bash
sudo cp deploy/relay-nginx.conf /etc/nginx/sites-available/khodroto-relay
sudo ln -s /etc/nginx/sites-available/khodroto-relay /etc/nginx/sites-enabled/khodroto-relay
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d relay.example.ir
```

بررسی سلامت عمومی رله:

```bash
curl https://relay.example.ir/health
```

خروجی مورد انتظار:

```json
{"ok":true,"service":"khodroto-divar-relay"}
```

endpointهای داده بدون توکن باید `403` بدهند. رله فقط جست‌وجوی خودرو و جزئیات آگهی را عبور می‌دهد؛ پراکسی عمومی نیست.

## بخش دوم: برنامه جهانی

در Render یا میزبان اصلی این متغیرها را ثبت کنید:

```dotenv
NODE_ENV=production
DIVAR_PROVIDER=web
DIVAR_API_BASE_URL=https://relay.example.ir
DIVAR_RELAY_TOKEN=همان_توکن_فایل_env_رله
DIVAR_CITY_IDS=1
DIVAR_WEB_CATEGORY=light
DIVAR_CACHE_TTL_MINUTES=10
```

سپس برنامه را Redeploy کنید. `render.yaml` برای دریافت اجباری URL و توکن رله آماده شده است.

## آزمون نهایی

1. آدرس زیر باید `viaRelay: true` و پس از اولین دریافت `connected: true` نشان دهد:

```text
https://YOUR-GLOBAL-DOMAIN/api/integration/status
```

2. در `/khodroto-admin` دکمه «جمع‌آوری داده واقعی همین حالا» را بزنید.
3. پیام موفق باید تعداد آگهی واقعی و تعداد صفحات دیوار را نشان دهد.
4. لینک هر کارت باید به `https://divar.ir/v/...` و نه صفحه عمومی نمونه منتهی شود.

## نکته قطعی زیرساخت

اگر نه سرور ایران، نه رله ایران و نه دسترسی رسمی وجود داشته باشد، یک پردازش مستقر در دیتاسنتر خارجی نمی‌تواند صرفاً با تغییر کد، IP خروجی ایرانی پیدا کند. بخش رله باید واقعاً روی زیرساخت دارای خروجی ایران اجرا شود. برنامه و تمام صفحات عمومی همچنان می‌توانند روی میزبان جهانی باقی بمانند و از خارج کشور باز شوند.
