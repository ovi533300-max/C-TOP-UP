# GY GAMING — Top-up website starter

## কী আছে
- User registration/login
- Wallet balance ledger (balance is calculated from ledger entries)
- bKash/Nagad deposit request with unique Transaction ID
- Admin manual verification before adding wallet credit
- Game top-up product catalogue and wallet-paid order requests
- Admin order completion or cancellation with automatic refund

## চালানোর নিয়ম
1. Node.js 20 বা নতুন সংস্করণ ইনস্টল করুন।
2. এই ফোল্ডারে terminal খুলে `npm install` চালান।
3. `.env.example` কপি করে `.env` নাম দিন।
4. `.env`-এ `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` বদলান। শক্তিশালী ও আলাদা পাসওয়ার্ড ব্যবহার করুন।
5. `npm start` চালান এবং `http://localhost:3000` খুলুন।

## গুরুত্বপূর্ণ: লাইভ পেমেন্টের আগে
এই starter **bKash/Nagad API-তে নিজে থেকে টাকা গ্রহণ করে না**। এটি manual-review flow: গ্রাহক পেমেন্ট করে নম্বর ও TrxID জমা দেয়; Admin নিজের provider app/merchant portal-এ লেনদেন যাচাই করে তারপর Approve করেন। কেবল Transaction ID দেখে অন্ধভাবে approve করবেন না।

সত্যিকারের স্বয়ংক্রিয় payment-এর জন্য bKash ও Nagad-এর অনুমোদিত merchant account, official API credentials, server-side payment creation/execute/verification এবং provider callback/webhook যুক্ত করতে হবে। ব্যক্তিগত নম্বরকে merchant gateway ধরে নেওয়া যাবে না; provider-এর ব্যবসায়িক শর্ত মেনে চলুন।

ডিফল্ট পণ্যের দাম উদাহরণ হিসেবে রাখা। আপনার অনুমোদিত সরবরাহকারী, অঞ্চল, সার্ভার ও মূল্য অনুযায়ী Admin-নিয়ন্ত্রিত catalogue এবং fulfillment সংযুক্ত করুন। Indonesia top-up/likes-এর মতো দাম-শূন্য সার্ভিস checkout থেকে ইচ্ছাকৃতভাবে বন্ধ রাখা হয়েছে।

## Production security checklist
- HTTPS বাধ্যতামূলক; reverse proxy-তে secure cookies ঠিকভাবে কনফিগার করুন।
- SQLite starter ছোট সাইট/পরীক্ষার জন্য; বড় সাইটে managed PostgreSQL এবং durable session store ব্যবহার করুন।
- Admin-এর জন্য MFA, আলাদা admin route, audit log, backup ও alerting যোগ করুন।
- CSRF protection, stricter rate limits, input validation, privacy/terms/refund policy এবং abuse monitoring যোগ করে security review করান।
- `.env`, database, session database বা user data কখনো public repository-তে আপলোড করবেন না।
- গেমের diamond/likes সরবরাহের জন্য অনুমোদিত provider ব্যবহার করুন এবং UID/region যাচাই করে তারপর fulfil করুন।

এই কোড production-ready payment gateway নয়; এটি নিরাপদভাবে manual review দিয়ে শুরু করার scaffold।
