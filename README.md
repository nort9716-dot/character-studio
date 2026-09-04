# Character Studio

نسخه فعلی شامل رابط کامل Character Studio و Backend آماده برای تولید تصویر است.

## Frontend
- مدیریت چند Character مستقل
- Original Reference / Identity Anchor
- Preservation Rules با اولویت مطلق هویت
- Pose Library تا Pose 27
- Outfit Library — Outfit 01 Classic Executive
- Expression Library — 6
- Camera Library — 16
- Lighting Library — 12
- Environment Library — 12
- Autonomous Creative Engine
- ساخت Prompt نهایی و Copy
- Gallery محلی و دانلود تصویر
- تنظیم Backend URL
- رابط Responsive برای موبایل و تبلت

## Backend
`server.mjs` یک API امن برای تولید تصویر فراهم می‌کند. کلید OpenAI فقط روی سرور قرار می‌گیرد و هرگز در Frontend یا GitHub قرار نمی‌گیرد.

### اجرا
```bash
npm install
cp .env.example .env
# مقدار OPENAI_API_KEY را فقط در .env روی سرور قرار بده
npm start
```

بعد در بخش Settings فرانت‌اند، آدرس `/api/generate` سرور را وارد کن.

## نکته مهم
GitHub Pages فقط Frontend است. تولید واقعی تصویر به اجرای Backend روی یک سرویس Server/Node نیاز دارد. هیچ API key یا Original Reference نباید در Repository عمومی قرار گیرد.
