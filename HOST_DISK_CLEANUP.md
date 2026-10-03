# خالی کردن فضای هاست و جلوگیری از پر شدن دوباره

هاست ۱ گیگابایتی پر شده و به همین دلیل دیپلوی FTP نیمه‌کاره مانده و آپدیت جدید اجرا نشده است.
این راهنما دو بخش دارد: **الان چه کار کنم** و **چه کنم که دوباره پر نشود**.

---

## ۰) اول ببینید فضا کجا رفته

در cPanel → Terminal (یا SSH):

```bash
cd ~
du -sh ~/* ~/.??* 2>/dev/null | sort -rh | head -20
```

و داخل خود اپ:

```bash
cd ~/repositories/khodroto      # یا هر مسیری که Application root است
du -sh * .??* 2>/dev/null | sort -rh | head -20
du -sh data/* 2>/dev/null | sort -rh
```

معمولاً روی این پروژه ترتیب مقصرها این است:

| مورد | حجم معمول | توضیح |
| --- | --- | --- |
| `node_modules/` | **~۱۵۰ مگابایت** | بزرگ‌ترین مصرف‌کننده |
| `~/.npm/_cacache` | ۱۰۰ تا ۴۰۰ مگابایت | کش نصب npm؛ کاملاً دورریختنی |
| `data/divar-cache.json` | بی‌نهایت رشد می‌کرد | کش جست‌وجوهای دیوار |
| `data/khodroto.db` + `-wal` | رشد تدریجی | لاگ‌ها و تاریخچه آگهی‌ها |
| `logs/`, `tmp/`, `.trash` | متغیر | لاگ cPanel و فایل‌های دورریز |

---

## ۱) آزادسازی فوری (به ترتیب بیشترین سود)

### ۱-۱. کش npm را پاک کنید — معمولاً بیشترین فضا

```bash
npm cache clean --force
rm -rf ~/.npm/_cacache
```

این کار هیچ ریسکی ندارد؛ npm دفعه بعد دوباره می‌سازد.

### ۱-۲. `node_modules` را فقط «تولیدی» نصب کنید — حدود ۱۵۰ مگابایت

سرور فقط `express` را لازم دارد. `react`، `vite` و `lucide` فقط موقع **ساخت** لازم‌اند و
خروجی‌شان از قبل داخل `dist/` است. در همین آپدیت این بسته‌ها به `devDependencies` منتقل شده‌اند:

```bash
cd ~/repositories/khodroto
rm -rf node_modules
npm ci --omit=dev
```

نتیجه: `node_modules` از **۱۵۴ مگابایت** به **۳.۷ مگابایت** می‌رسد.

> ⚠️ بعد از این کار دیگر روی هاست `npm run build` کار نمی‌کند — و لازم هم نیست،
> چون `dist/` آماده از گیت‌هاب اکشن آپلود می‌شود. اگر روزی خواستید روی خود هاست build بگیرید:
> `npm ci --include=dev && npm run build && npm prune --omit=dev`

### ۱-۳. دیتابیس و کش را هرس کنید

اسکریپت آماده در همین ریپو هست. اول گزارش بگیرید (هیچ چیزی حذف نمی‌کند):

```bash
npm run prune
```

اگر خروجی قانع‌کننده بود:

```bash
npm run prune:apply
```

چه چیزی حذف می‌شود:

- گزارش فعالیت مدیریت قدیمی‌تر از `audit_retention_days` (پیش‌فرض ۳۶۵ روز)
- لاگ اجرای کراولر و صف هشدارها قدیمی‌تر از `log_retention_days` (پیش‌فرض ۹۰ روز)
- تاریخچه قیمت قدیمی‌تر از ۱۸۰ روز و رصد روزانه قدیمی‌تر از ۶۰ روز
- کدهای OTP و نشست‌های منقضی
- ورودی‌های اضافی `data/divar-cache.json`
- در پایان `VACUUM` و `wal_checkpoint` تا فضا واقعاً به سیستم‌فایل برگردد

چه چیزی **هرگز** حذف نمی‌شود: کاربران، اشتراک‌ها، سفارش‌ها، کدهای تخفیف، موجودی و مشتریان
نمایشگاه، تیکت‌ها و تنظیمات.

برای پاک‌سازی عمیق‌تر (حذف آگهی‌های حذف‌شده و کل فایل کش):

```bash
node scripts/prune-storage.mjs --apply --aggressive
```

### ۱-۴. دورریزهای هاست

```bash
rm -rf ~/.cache ~/tmp/* ~/.trash/* 2>/dev/null
find ~/logs -name "*.gz" -delete 2>/dev/null
find ~ -name "*.log" -size +10M 2>/dev/null        # اول ببینید، بعد حذف کنید
```

در cPanel هم: **File Manager → Trash → Empty Trash** و بخش **Disk Usage** را نگاه کنید.
اگر ایمیل روی همین اکانت دارید، صندوق‌های بزرگ هم در همین سهمیه حساب می‌شوند.

### ۱-۵. نسخه‌های تکراری پروژه

گاهی چند کپی از پروژه روی هاست می‌ماند (`khodroto-old`، `public_html/khodroto`، بک‌آپ‌های zip):

```bash
ls -la ~ ~/public_html
du -sh ~/*.zip ~/*.tar.gz 2>/dev/null
```

هرچه مربوط به اپ فعال نیست را حذف کنید.

---

## ۲) کاری که کردیم تا دوباره پر نشود

### الف) سقف برای کش دیوار (ریشه‌ی اصلی رشد بی‌پایان)

قبلاً هر ترکیب فیلتری که کاربر در `/cars` می‌زد، یک ورودی **دائمی** در
`data/divar-cache.json` می‌ساخت و هیچ‌وقت پاک نمی‌شد. حالا سقف دارد:

```dotenv
DIVAR_CACHE_MAX_ENTRIES=150      # حداکثر تعداد جست‌وجوی ذخیره‌شده
DIVAR_CACHE_MAX_AGE_HOURS=72     # ورودی قدیمی‌تر از این خودکار حذف می‌شود
```

این دو متغیر را در Setup Node.js App اضافه کنید (یا دست نزنید تا همین پیش‌فرض‌ها اعمال شود).
فایل بزرگِ فعلی هم در اولین اجرای نسخه‌ی جدید خودکار هرس می‌شود.

### ب) جداسازی وابستگی‌های build از runtime

`react`، `react-dom`، `vite`، `@vitejs/plugin-react` و `lucide-react` به `devDependencies`
منتقل شدند. حالا `npm ci --omit=dev` روی هاست فقط ۳.۷ مگابایت نصب می‌کند.

### ج) اسکریپت هرس

`scripts/prune-storage.mjs` به همراه `npm run prune` و `npm run prune:apply`.

---

## ۳) هرس خودکار ماهانه (توصیه‌شده)

در cPanel → **Cron Jobs** یک کار ماهانه بسازید (اول هر ماه، ساعت ۴ بامداد):

```
0 4 1 * * cd ~/repositories/khodroto && /usr/local/bin/node scripts/prune-storage.mjs --apply >> ~/logs/prune.log 2>&1
```

> مسیر دقیق node را با `which node` بگیرید؛ روی cPanel معمولاً داخل مسیر nodevenv است.

و یک کار هفتگی برای کش npm:

```
0 5 * * 0 rm -rf ~/.npm/_cacache
```

---

## ۴) ترتیب درست کارها برای اینکه آپدیت بالاخره Live شود

```bash
cd ~/repositories/khodroto

# ۱) فضا باز کنید
npm cache clean --force && rm -rf ~/.npm/_cacache
npm run prune:apply

# ۲) مطمئن شوید حداقل ۳۰۰ مگابایت آزاد دارید
df -h . ; du -sh ~

# ۳) کد جدید را بیاورید (سریع‌تر از FTP)
git fetch origin && git reset --hard origin/main
npm ci --omit=dev

# ۴) ری‌استارت
mkdir -p tmp && touch tmp/restart.txt
```

سپس تأیید کنید:

```text
https://bidup.ir/api/subscription/discount?code=TEST&plan=pro
```

اگر چیزی غیر از `NOT_FOUND` برگشت، نسخه‌ی جدید بالا آمده است.

> اگر می‌خواهید از همان GitHub Action استفاده کنید، **اول** فضا را خالی کنید و بعد از تب
> Actions دکمه‌ی **Re-run** را بزنید؛ وگرنه آپلود دوباره وسط کار می‌شکند.

---

## ۵) چک‌لیست سریع ماهانه

- [ ] `du -sh ~` زیر ۷۰٪ سهمیه باشد
- [ ] `npm run prune` را اجرا و خروجی‌اش را ببینید
- [ ] `ls -lh data/` — `divar-cache.json` نباید از چند مگابایت بیشتر شود
- [ ] `~/.npm/_cacache` نباید وجود داشته باشد
- [ ] فایل zip/بک‌آپ قدیمی در خانه نمانده باشد
