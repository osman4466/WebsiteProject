# Janissary Wear (জ্যানিসারি ওয়্যার)

ই-কমার্স ওয়েবসাইট + অ্যাডমিন প্যানেল। Vercel-এ সম্পূর্ণ ফ্রিতে চলে।

## পেজগুলো

| পেজ | লিংক |
|---|---|
| হোম | `/` |
| ক্যাটাগরি (Men / Women ও তাদের স্টাইল) | `/categories` |
| সব প্রোডাক্ট (ফিল্টার, সার্চ, সর্ট) | `/products` |
| প্রোডাক্ট ডিটেইল | `/product?id=...` |
| কার্ট ও চেকআউট (ক্যাশ অন ডেলিভারি) | `/cart` |
| অ্যাডমিন প্যানেল | `/admin` |

## ফাইল স্ট্রাকচার

```
janissary-wear/
├── public/            ওয়েবসাইটের পেজ, CSS, JS
│   ├── index.html, categories.html, products.html, product.html, cart.html
│   ├── admin/         অ্যাডমিন প্যানেল (index.html + admin.js)
│   ├── css/           style.css, admin.css
│   └── js/app.js
├── api/               ব্যাকএন্ড (Vercel serverless functions)
│   ├── login.js  products.js  categories.js  orders.js  image.js  settings.js
│   └── _lib.js        ডাটাবেস + লগইন সিকিউরিটি
├── server.js          শুধু নিজের কম্পিউটারে টেস্ট করার জন্য
├── vercel.json
└── .env.example
```

## Vercel-এ পাবলিশ করার ধাপ (সব ফ্রি)

### ধাপ ১: GitHub-এ কোড রাখুন
1. github.com-এ অ্যাকাউন্ট খুলুন (ফ্রি)।
2. **New repository** চাপুন, নাম দিন `janissary-wear`, **Private** সিলেক্ট করুন, তৈরি করুন।
3. **uploading an existing file** লিংকে চাপুন, এই ফোল্ডারের সব ফাইল (`public`, `api`, `package.json`, `vercel.json` ইত্যাদি) টেনে ছেড়ে দিন, তারপর **Commit changes**।

### ধাপ ২: Vercel-এ প্রোজেক্ট ইম্পোর্ট
1. vercel.com-এ **Sign up with GitHub** দিয়ে ঢুকুন (Hobby প্ল্যান ফ্রি)।
2. **Add New > Project** থেকে `janissary-wear` রিপো **Import** করুন।
3. Framework Preset: **Other**। Build Command ও Output Directory ফাঁকা রাখুন।
4. এখনই **Deploy** চাপবেন না। আগে ধাপ ৩ ও ৪ করুন (অথবা Deploy করে পরে Redeploy করুন)।

### ধাপ ৩: অ্যাডমিন লগইনের তথ্য বসান
Project > **Settings > Environment Variables**-এ তিনটা যোগ করুন:

| Name | Value |
|---|---|
| `ADMIN_EMAIL` | আপনার অ্যাডমিন ইমেইল |
| `ADMIN_PASSWORD` | আপনার পাসওয়ার্ড |
| `SESSION_SECRET` | যেকোনো লম্বা র‍্যান্ডম লেখা (৩০+ অক্ষর) |

### ধাপ ৪: ফ্রি ডাটাবেস যুক্ত করুন (Upstash Redis)
এটা ছাড়া প্রোডাক্ট, ছবি ও অর্ডার সেভ হবে না।
1. Project > **Storage** ট্যাব > **Create Database** (বা Marketplace)।
2. **Upstash > Redis** সিলেক্ট করুন, **Free** প্ল্যান নিন, প্রোজেক্টের সাথে **Connect** করুন।
3. এতে `KV_REST_API_URL` ও `KV_REST_API_TOKEN` নিজে থেকেই যোগ হয়ে যায়।

### ধাপ ৫: Deploy / Redeploy
**Deployments** ট্যাবে সর্বশেষ ডেপ্লয়ের পাশে **Redeploy** চাপুন। কয়েক মিনিটে সাইট লাইভ হবে।

### ধাপ ৬: অ্যাডমিন প্যানেল ব্যবহার
1. `আপনার-সাইট.vercel.app/admin` খুলুন, ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন।
2. **Store settings**: ফোন, WhatsApp, ডেলিভারি চার্জ বসান।
3. **Categories**: ক্যাটাগরি যোগ বা এডিট করুন (৪টা ডিফল্ট আছে)।
4. **Products**: **Add product** চাপুন, নাম, ক্যাটাগরি, দাম, সাইজ, স্টক ও ছবি দিন।
5. **Orders**: কাস্টমারের অর্ডার দেখুন, কল বা WhatsApp করুন, স্ট্যাটাস বদলান।

## নিজের কম্পিউটারে টেস্ট (ঐচ্ছিক)
Node.js ১৮+ থাকলে: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=test node server.js`, তারপর http://localhost:3000 খুলুন। এই মোডে ডাটা সেভ থাকে না (সার্ভার বন্ধ করলে মুছে যায়)।

## নিরাপত্তা
- GitHub রিপো **Private** রাখুন এবং আসল পাসওয়ার্ড কোনো ফাইলে লিখবেন না, শুধু Vercel-এর Environment Variables-এ রাখুন।
- পাসওয়ার্ড বদলাতে: Vercel-এ `ADMIN_PASSWORD` পাল্টে Redeploy করুন।
- অ্যাডমিন লগইন ১২ ঘণ্টা পর্যন্ত বৈধ থাকে।

## ক্যাটাগরি কীভাবে কাজ করে (Men / Women + সাব-ক্যাটাগরি)

- দুই স্তরের ক্যাটাগরি: **মেইন ক্যাটাগরি** (Men, Women) আর তার ভেতরে **সাব-ক্যাটাগরি** (T-Shirt, Polo Shirt, Drop Shoulder)।
- `/admin` > **Categories**:
  - **Add category** দিয়ে নতুন মেইন ক্যাটাগরি (যেমন Kids) বা যেকোনো সাব-ক্যাটাগরি বানান। "Where does it go?" থেকে বেছে নিন কোন মেইন ক্যাটাগরির ভেতরে যাবে।
  - মেইন ক্যাটাগরির পাশের **Add sub-category** বাটনে সরাসরি তার ভেতরে নতুন সাব-ক্যাটাগরি যোগ হয়।
  - **Edit** দিয়ে নাম, ছবি বা কোন ক্যাটাগরির ভেতরে থাকবে তা বদলানো যায়।
- `/admin` > **Products** > **Add product**-এ ক্যাটাগরি তালিকা Men ও Women নামে গ্রুপ করা দেখাবে। সাব-ক্যাটাগরি বেছে নিন।
- Men পেজে Men-এর সব সাব-ক্যাটাগরির প্রোডাক্ট একসাথে দেখায়, আর T-Shirt বাছলে শুধু T-Shirt।
- যে ক্যাটাগরিতে প্রোডাক্ট বা সাব-ক্যাটাগরি আছে সেটা মোছা যায় না, আগে সেগুলো সরাতে হবে।
- পুরনো ডাটা নিরাপদ: আগের ক্যাটাগরিতে প্রোডাক্ট থাকলে সেটা থেকে যায় (Edit করে Men/Women-এর ভেতরে সরানো যাবে), আর ফাঁকা পুরনো ডিফল্টগুলো নিজে থেকে সরে যায়।

## সাইট আপডেট করার নিরাপদ নিয়ম (Vercel)

1. নতুন zip এক্সট্র্যাক্ট করুন।
2. GitHub রিপোতে **Add file > Upload files** দিয়ে ভেতরের সব কিছু (`api`, `public`, `package.json`, `vercel.json`, `server.js`, `README.md`) আবার আপলোড করুন। একই নামের ফাইল নিজে থেকে বদলে যায়।
3. **Commit changes** চাপলে Vercel নিজে নতুন করে ডেপ্লয় করে (১-২ মিনিট)। Environment Variables ও ডাটাবেস আর বদলাতে হয় না।
4. শেষে `/api/health` খুলে `"database":"connected"` দেখুন।
