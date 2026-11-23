<div dir="rtl">

# העלאת האפליקציה לאינטרנט עם Cloudflare Pages — מדריך צעד אחר צעד

אחרי המדריך הזה תהיה לאפליקציה כתובת קבועה באינטרנט, למשל `https://trip-planner.pages.dev`.
מכל שינוי שנשמר ב־GitHub (בענף `main`) Cloudflare בונה ומעלה גרסה חדשה לבד, תוך כמה דקות.

מה צריך לפני שמתחילים:

- חשבון Cloudflare (כבר יש).
- חשבון GitHub עם המאגר של האפליקציה.
- גישה ללוח הבקרה של Supabase.

**חשוב:** בשום שלב לא מעתיקים את סיסמת מסד הנתונים או מפתח `secret` / `service_role`.
משתמשים רק בשני הערכים הציבוריים שמופיעים בהמשך.

---

## חלק א: יצירת האתר ב־Cloudflare

1. נכנסים ל־[dash.cloudflare.com](https://dash.cloudflare.com).
2. בתפריט שבצד לוחצים על **Workers & Pages**.
3. לוחצים על הכפתור **Create application**.
4. בוחרים **Pages**, ואז **Connect to Git**.
5. בוחרים **GitHub**. נפתח חלון של GitHub:
   - בוחרים **Only select repositories** ואת המאגר של האפליקציה בלבד.
   - לוחצים **Install & Authorize**.
6. חוזרים ל־Cloudflare, בוחרים את המאגר ולוחצים **Begin setup**.

## חלק ב: הגדרות הבנייה (מעתיקים בדיוק)

במסך **Set up builds and deployments** ממלאים:

| שדה | מה כותבים |
| --- | --- |
| Project name | `trip-planner` (או שם אחר באנגלית. זה יהיה חלק מהכתובת, ואי אפשר לשנות אותו אחר כך) |
| Production branch | `main` |
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | משאירים ריק |

אחר כך פותחים את **Environment variables (advanced)** ומוסיפים שני משתנים.
לכל אחד לוחצים **Add variable**:

| Variable name | Value — מאיפה מעתיקים |
| --- | --- |
| `VITE_SUPABASE_URL` | ב־Supabase: **Project Settings** ← **Data API** ← **Project URL**. נראה כך: `https://xxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ב־Supabase: **Project Settings** ← **API Keys** ← המפתח **Publishable**. מתחיל ב־`sb_publishable_` |

אלה אותם ערכים שבקובץ `.env.local` במחשב. מותר להם להיות גלויים, כי הם ממילא מגיעים לדפדפן.

לוחצים **Save and Deploy** ומחכים כמה דקות עד שמופיע **Success**.
הכתובת של האתר מופיעה למעלה (מסתיימת ב־`.pages.dev`). **שומרים אותה, צריך אותה בחלק ד.**
אם השם כבר היה תפוס, Cloudflare מוסיף לו כמה אותיות, למשל `trip-planner-4xk.pages.dev`.
בחלק ד משתמשים בכתובת המדויקת שמופיעה.

## חלק ג: לוודא שהמשתנים מוגדרים גם לגרסאות ניסיון

1. בפרויקט ב־Cloudflare לוחצים **Settings** ← **Variables and Secrets**.
2. בודקים ששני המשתנים מופיעים גם תחת **Production** וגם תחת **Preview**.
   אם חסרים ב־Preview, מוסיפים אותם שם עם אותם ערכים.
3. אם משנים משתנה, הוא נכנס לתוקף רק בבנייה הבאה: **Deployments** ← הגרסה האחרונה ←
   **Retry deployment**.

גרסת ניסיון (Preview) נוצרת לכל שינוי שעוד לא מוזג ל־`main`, ומקבלת כתובת משלה.
כך אפשר לבדוק שינוי לפני שהוא מגיע לאתר הראשי.

## חלק ד: להגיד ל־Supabase שהאתר החדש מורשה

בלי השלב הזה הקישור לאיפוס סיסמה במייל לא יחזיר אותך לאתר.

1. ב־Supabase: **Authentication** ← **URL Configuration**.
2. ב־**Site URL** כותבים את כתובת האתר מחלק ב, למשל `https://trip-planner.pages.dev`,
   ולוחצים **Save**.
3. ב־**Redirect URLs** לוחצים **Add URL** ומוסיפים שתי שורות (מחליפים את `trip-planner` בשם
   שבחרת):
   - `https://trip-planner.pages.dev/**`
   - `https://*.trip-planner.pages.dev/**` (בשביל גרסאות הניסיון)
4. את השורה של `localhost`, אם יש כזו, משאירים. היא משמשת לעבודה במחשב.

## חלק ה: בדיקה קצרה

1. פותחים את כתובת האתר. מופיע מסך הכניסה.
2. נכנסים עם המייל והסיסמה הרגילים ופותחים טיול.
3. מרעננים את הדף (F5). הטיול נפתח שוב.
4. באייפון: פותחים את הכתובת ב־Safari ← כפתור השיתוף ← **הוספה למסך הבית**.

אם משהו לא עובד, שולחים צילום מסך ונבדוק.

## אם גרסה חדשה מקולקלת: חזרה לגרסה קודמת

1. ב־Cloudflare: **Workers & Pages** ← הפרויקט ← **Deployments**.
2. מוצאים ברשימה את הגרסה האחרונה שעבדה טוב.
3. לוחצים על שלוש הנקודות (**⋯**) שלידה ← **Rollback to this deployment** ← מאשרים.

החזרה מיידית. אחר כך מבקשים לתקן את הקוד, כי השינוי הבא ב־`main` יעלה גרסה חדשה שוב.

</div>
