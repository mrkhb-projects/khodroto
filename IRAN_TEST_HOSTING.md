# گزینه‌های ایرانی برای تست آنلاین خودروتو

بررسی در ۱۰ مهر ۱۴۰۵ انجام شده است. وضعیت پلن‌های رایگان ممکن است تغییر کند؛ قبل از انتقال، موجودبودن پلن را داخل کنسول همان سرویس بررسی کنید.

## انتخاب اول: لیارا

لیارا صفحه رسمی «هاست ابری رایگان» دارد و Node.js و Docker را در فناوری‌های پشتیبانی‌شده اعلام کرده است:

- https://liara.ir/products/free-cloud-host/
- https://docs.liara.ir/app-deploy/nodejs/cli/
- https://docs.liara.ir/app-deploy/nodejs/desktop

مزیت برای خودروتو:

- زیرساخت ایران
- پشتیبانی مستقیم Node.js
- دامنه آزمایشی `liara.run`
- امکان Upload فایل ZIP
- اجرای خودکار `npm install`، اسکریپت `build` و اسکریپت `start`

پروژه اکنون اسکریپت لازم را دارد:

```json
"start": "node server.js"
```

### استقرار ZIP در لیارا

1. در لیارا یک برنامه Node.js نسخه 22 بسازید.
2. فایل ZIP پروژه را بدون `node_modules` و `dist` بارگذاری کنید.
3. پورت را `3000` قرار دهید.
4. متغیرهای زیر را ثبت کنید:

```dotenv
NODE_ENV=production
PORT=3000
DIVAR_PROVIDER=web
DIVAR_API_BASE_URL=https://api.divar.ir
DIVAR_CITY_IDS=1
DIVAR_WEB_CATEGORY=light
DIVAR_CACHE_TTL_MINUTES=10
DATABASE_FILE=data/khodroto.db
DIVAR_CACHE_FILE=data/divar-cache.json
ADMIN_PHONE=09xxxxxxxxx
ADMIN_PASSWORD=your-long-admin-password
CREDENTIALS_ENCRYPTION_KEY=your-random-32-character-secret
```

5. در صورت ارائه Disk، مسیر `data` را به دیسک پایدار متصل کنید.
6. Deploy را اجرا و `/api/integration/status` را بررسی کنید.

### استقرار CLI

```bash
npm install -g @liara/cli
liara login
liara deploy --port=3000 --platform=node
```

نکته: صفحه رسمی لیارا در برخی زمان‌ها پیام توقف موقت ارائه هاست رایگان به‌علت ظرفیت زیرساخت نشان می‌دهد. اگر گزینه Free در کنسول موجود نبود، گزینه بعدی را امتحان کنید.

## انتخاب دوم: هاست رایگان Server.ir

صفحه رسمی آن‌ها یک هاست رایگان با ۱ گیگ SSD، SSL و پشتیبانی Node.js معرفی کرده و کد ثبت `Freehost` را اعلام می‌کند:

- https://server.ir/hosting/freehost/

این گزینه برای تست کوتاه مناسب است، اما قبل از انتقال بررسی کنید که اجرای دائم Process، Node 22 و SQLite را اجازه بدهد؛ هاست cPanel ممکن است برای worker ده‌دقیقه‌ای محدودیت داشته باشد.

## انتخاب سوم: اعتبار آزمایشی چابکان

چابکان برای سرویس Node.js اعتبار اولیه معرفی می‌کند و مستندات رسمی آن استقرار Node.js، Docker و CI/CD از GitHub را پوشش می‌دهد:

- https://chabokan.net/products/cloud-hosting/nodejs/
- https://docs.chabokan.net/
- https://docs.chabokan.net/cicd/github/

این گزینه رایگان دائمی نیست، اما برای تست واقعی اتصال دیوار و برنامه Node.js مناسب‌تر از هاست اشتراکی است.

## انتخاب چهارم: اعتبار سرور ابری وب‌داده

وب‌داده اعلام کرده است که برای سرور ابری ایران اعتبار اولیه ارائه می‌کند و امکان Root و Docker وجود دارد:

- https://webdade.com/free-vps

برای تست Docker کامل پروژه مناسب است، اما اعتبار زمانی/ریالی محدود است و رایگان دائمی محسوب نمی‌شود.

## پیشنهاد عملی

1. ابتدا Free Node.js لیارا را داخل کنسول بررسی کنید.
2. اگر فعال بود، کل پروژه را مستقیم روی لیارا اجرا کنید؛ در این حالت Render و رله لازم نیست.
3. اگر Free لیارا موقتاً موجود نبود، برای تست ساده Server.ir را بررسی کنید.
4. اگر اجرای دائم Node یا SQLite در Server.ir ممکن نبود، از اعتبار اولیه چابکان یا وب‌داده استفاده کنید.

برای تشخیص موفقیت اتصال، خروجی زیر باید `connected: true` و `provider: web` داشته باشد:

```text
https://YOUR-IRAN-HOST/api/integration/status
```
