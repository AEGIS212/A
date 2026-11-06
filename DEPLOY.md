# النشر على سيرفر (VPS) بـ Docker

يشغّل البوت والموقع مع Caddy اللي يعطي HTTPS تلقائياً.

## 1. المتطلبات
- سيرفر Linux (Ubuntu 22.04 أو أحدث) فيه IP ثابت.
- دومين تشير سجلات A له إلى IP السيرفر، مثلاً `guardian.example.com`.
- Docker و Docker Compose مثبتين:
  ```
  curl -fsSL https://get.docker.com | sh
  ```
- فتح المنافذ 80 و443 في الجدار الناري.

## 2. تجهيز الملفات
```
mkdir -p state/logs state/backups state/tickets
echo '{}' > state/data.json
echo '{}' > state/licenses.json
echo '{}' > state/settings.json
cp .env.example .env
```

## 3. ملف `.env`
```
TOKEN=توكن_البوت
CLIENT_SECRET=الـ_Secret
DASH_URL=https://guardian.example.com
PORT=3000
DOMAIN=guardian.example.com
```

في بوابة المطورين، OAuth2 → Redirects، أضف:
`https://guardian.example.com/callback`

## 4. التشغيل
```
docker compose up -d --build
docker compose logs -f guardian
```

لازم تشوف سطر اسم البوت، ثم افتح `https://guardian.example.com`.

## 5. توليد رمز التفعيل على السيرفر
```
docker compose exec guardian node license.js gen 30
```

## 6. التحديث لاحقاً
```
docker compose up -d --build
```
الحالة محفوظة في مجلد `state/`، فالتحديث ما يمسح التفعيل ولا النسخ.

## 7. النسخ الاحتياطي
انسخ مجلد `state/` دورياً، فيه كل بيانات البوت والتفعيل. ولا ترفع `.env` ولا `state/` لأي مكان عام.
