# راه‌اندازی آنلاین داده واقعی و مدیریت خودروتو

## ورود اختصاصی مدیریت

پنل مدیریت از ورود عمومی کاربران جدا شده است:

```text
https://YOUR-DOMAIN/khodroto-admin
```

در محیط میزبان این دو متغیر را تعریف کنید:

```dotenv
ADMIN_PHONE=09xxxxxxxxx
ADMIN_PASSWORD=a-unique-password-with-at-least-12-characters
```

`ADMIN_PASSWORD` را در Git یا فایل عمومی قرار ندهید. نشست مدیریت ۱۲ ساعت اعتبار دارد، در Cookie امن HttpOnly نگهداری می‌شود و تلاش‌های ناموفق محدود می‌شوند. مسیر قدیمی `/admin` فقط به مسیر اختصاصی جدید هدایت می‌شود.

## چرا روی Render داده واقعی دیوار دریافت نمی‌شود؟

Render و بیشتر سرویس‌های رایگان از دیتاسنتر خارجی درخواست می‌فرستند. دیوار ممکن است TLS یا درخواست endpointهای وب را برای این شبکه‌ها پیش از دریافت پاسخ قطع کند. این خطا با تغییر DNS یا کد رابط کاربری حل نمی‌شود.

خودروتو سه حالت اتصال دارد:

### ۱. سرور ایرانی (پیشنهاد اصلی)

کل برنامه را روی VPS یا PaaS ایران اجرا کنید و تنظیمات پیش‌فرض را نگه دارید:

```dotenv
DIVAR_PROVIDER=web
DIVAR_API_BASE_URL=https://api.divar.ir
```

### ۲. برنامه روی Render + رله خصوصی ایران

یک reverse proxy خصوصی و تحت کنترل خودتان در ایران قرار دهید و در Render وارد کنید:

```dotenv
DIVAR_PROVIDER=web
DIVAR_API_BASE_URL=https://relay.example.ir
DIVAR_RELAY_TOKEN=your-long-random-relay-token
```

خودروتو توکن را با هدر `x-khodroto-relay-token` برای رله می‌فرستد. رله باید فقط مسیرهای لازم زیر را به `https://api.divar.ir` عبور دهد:

```text
POST /v8/postlist/w/search
GET  /v8/posts-v2/web/:token
```

از پراکسی عمومی ناشناس استفاده نکنید و رله را بدون توکن روی اینترنت باز نگذارید.

### ۳. API رسمی کنار دیوار

```dotenv
DIVAR_PROVIDER=kenar
KENAR_API_KEY=your-server-side-key
```

کلید فقط در سرور نگهداری می‌شود.

## تشخیص اتصال

در پنل مدیریت، بخش «جمع‌آوری داده» اکنون این موارد را نشان می‌دهد:

- متصل یا قطع بودن واقعی، نه صرفاً وجود تنظیمات
- اتصال مستقیم، رله ایران یا کنار رسمی
- آخرین کد خطای upstream
- تعداد جست‌وجوهای کش‌شده
- اجرای دستی جمع‌آوری

همچنین endpoint زیر برای بررسی فنی وجود دارد:

```text
GET /api/integration/status
```

اگر `connected` برابر `false` و خطا `UPSTREAM_ERROR` باشد، سرور میزبان به دیوار دسترسی شبکه ندارد و باید از حالت ۱، ۲ یا ۳ استفاده شود.
