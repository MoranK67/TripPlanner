<div dir="rtl">

# שמירה על Supabase ער (keep-alive) — מדריך צעד אחר צעד

## למה זה צריך

בתוכנית החינמית, Supabase "מרדים" (Paused) את הפרויקט אחרי כשבוע בלי פעילות במסד הנתונים.
כשהוא מורדם, האתר לא מצליח לטעון טיולים. זה קרה ב־23.11.2026.

כדי למנוע את זה הוספנו פעולה אוטומטית ב־GitHub בשם **keep-alive**. פעם בשלושה ימים היא שולחת
למסד הנתונים שאלה קטנה אחת, וכך הוא נשאר ער. היא לא קוראת ולא משנה שום מידע שלך.

**חשוב:** משתמשים רק בשני הערכים הציבוריים, אותם ערכים שכבר נמצאים ב־Cloudflare.
אף פעם לא מעתיקים את סיסמת מסד הנתונים או מפתח `secret` / `service_role`.
הפעולה בודקת בעצמה ומסרבת לעבוד עם מפתח שלא מתחיל ב־`sb_publishable_`.

> הפעולה מתחילה לרוץ רק אחרי שהשינוי מוזג לענף `main`. לפני כן היא לא תופיע ברשימה של **Actions**.

---

## חלק א: הוספת שני ה־Secrets ב־GitHub (פעם אחת)

1. פותחים את המאגר ב־GitHub.
2. לוחצים על **Settings** (בשורת הלשוניות שלמעלה).
3. בתפריט שבצד: **Secrets and variables** ואז **Actions**.
4. לוחצים **New repository secret** וממלאים:
   - **Name:** `SUPABASE_URL`
   - **Secret:** הכתובת של הפרויקט, בדיוק כמו `VITE_SUPABASE_URL` ב־Cloudflare
     (נראית כך: `https://<משהו>.supabase.co`)
   - לוחצים **Add secret**.
5. שוב **New repository secret**:
   - **Name:** `SUPABASE_PUBLISHABLE_KEY`
   - **Secret:** המפתח הציבורי, בדיוק כמו `VITE_SUPABASE_PUBLISHABLE_KEY` ב־Cloudflare
     (מתחיל ב־`sb_publishable_`)
   - לוחצים **Add secret**.

איפה למצוא את הערכים אם צריך: ב־Cloudflare (Workers & Pages → הפרויקט → Settings →
Variables and Secrets), או ב־Supabase (Project Settings → Data API לכתובת, API Keys למפתח **Publishable**).

GitHub שומר את הערכים מוסתרים. גם אחר כך אי אפשר לראות אותם, רק להחליף אותם.

## חלק ב: הרצה ראשונה ביד ובדיקה שהיא ירוקה

1. במאגר ב־GitHub לוחצים על הלשונית **Actions**.
2. ברשימה שבצד בוחרים **keep-alive**.
3. מימין לוחצים **Run workflow**, ואז שוב על הכפתור הירוק **Run workflow**.
4. מחכים כחצי דקה ומרעננים. מופיעה שורה חדשה:
   - **וי ירוק** — הכול עובד. אין צורך לעשות שום דבר נוסף.
   - **איקס אדום** — לוחצים על השורה ואז על **Ping Supabase database** כדי לראות את ההודעה:
     - "Missing repository secrets" — אחד ה־Secrets חסר או שהשם שלו לא מדויק. חוזרים לחלק א.
     - "is not a publishable key" — הודבק מפתח לא נכון. מחליפים אותו במפתח שמתחיל ב־`sb_publishable_`.
     - "the publishable key is wrong or was revoked" — המפתח לא תקין. מעתיקים אותו שוב מ־Cloudflare.
     - "The project may be paused or down" — הפרויקט מורדם. נכנסים ל־Supabase, לוחצים
       **Restore project**, מחכים כמה דקות ומריצים שוב.

מעכשיו הפעולה רצה לבד כל שלושה ימים. אם היא נכשלת, GitHub שולח מייל.

## חלק ג: אם GitHub כיבה את הפעולה

GitHub מכבה פעולות מתוזמנות אחרי **60 יום בלי שום שינוי במאגר**. כשזה קורה מגיע מייל מ־GitHub,
ובלשונית **Actions** מופיעה הודעה צהובה ליד keep-alive.

כדי להפעיל מחדש:

1. **Actions** ← בוחרים **keep-alive** ברשימה שבצד.
2. לוחצים על הכפתור **Enable workflow**.
3. כדאי להריץ פעם אחת ביד (חלק ב) ולוודא שזה ירוק.

אם בינתיים הפרויקט ב־Supabase כבר נרדם, קודם לוחצים שם **Restore project**.

</div>
