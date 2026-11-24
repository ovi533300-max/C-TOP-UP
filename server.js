require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
const db = new Database("gy-gaming.sqlite");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS deposits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 method TEXT NOT NULL CHECK(method IN ('bkash','nagad')),
 amount INTEGER NOT NULL CHECK(amount > 0),
 sender_number TEXT NOT NULL,
 trx_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wallet_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 amount INTEGER NOT NULL,
 type TEXT NOT NULL,
 reference TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 product_id TEXT NOT NULL,
 product_name TEXT NOT NULL,
 player_id TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(amount > 0),
 status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','completed','cancelled')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const products = [
  {id:"ff-100", name:"Free Fire 100 Diamonds", price:90},
  {id:"ff-210", name:"Free Fire 210 Diamonds", price:180},
  {id:"ff-520", name:"Free Fire 520 Diamonds", price:430},
  {id:"ff-1080", name:"Free Fire 1080 Diamonds", price:850},
  {id:"ff-weekly", name:"Weekly Membership", price:160},
  {id:"ff-monthly", name:"Monthly Membership", price:790},
  {id:"level-pass", name:"Level Up Pass", price:150},
  {id:"indo-topup", name:"Indonesia Top Up (manual quote)", price:0},
  {id:"likes", name:"Like Service (manual quote)", price:0}
];

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({limit:"20kb"}));
app.use(express.urlencoded({extended:false, limit:"20kb"}));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: "." }),
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly:true, sameSite:"strict", secure:process.env.NODE_ENV === "production", maxAge: 1000*60*60*8 }
}));
app.use("/api/", rateLimit({windowMs:15*60*1000, limit:120, standardHeaders:true, legacyHeaders:false}));
app.use(express.static(path.join(__dirname,"public")));

const requireUser = (req,res,next) => req.session.user ? next() : res.status(401).json({error:"আগে লগইন করুন।"});
const requireAdmin = (req,res,next) => req.session.admin ? next() : res.status(401).json({error:"Admin login required."});
const balanceOf = userId => {
 const row = db.prepare("SELECT COALESCE(SUM(amount),0) AS balance FROM wallet_ledger WHERE user_id=?").get(userId);
 return row.balance;
};

app.get("/api/config", (req,res) => res.json({
  brand:"GY GAMING",
  paymentNumbers:{bkash:process.env.BKASH_NUMBER || "01309717636", nagad:process.env.NAGAD_NUMBER || "01309717636"},
  paymentMode:"manual_review",
  products
}));

app.post("/api/register", async (req,res) => {
 const {name,email,password} = req.body || {};
 if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== "string" || password.length < 10)
   return res.status(400).json({error:"নাম, সঠিক ইমেইল এবং কমপক্ষে ১০ অক্ষরের পাসওয়ার্ড দিন।"});
 try {
  const hash = await bcrypt.hash(password, 12);
  const info = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name.trim().slice(0,60),email.toLowerCase(),hash);
  req.session.user = {id:Number(info.lastInsertRowid), name:name.trim(), email:email.toLowerCase()};
  res.json({ok:true});
 } catch(e) { res.status(400).json({error:"এই ইমেইল আগে থেকে ব্যবহৃত হতে পারে।"}); }
});

app.post("/api/login", async (req,res) => {
 const {email,password} = req.body || {};
 const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email||"").toLowerCase());
 if (!user || !(await bcrypt.compare(String(password||""),user.password_hash))) return res.status(401).json({error:"ইমেইল বা পাসওয়ার্ড সঠিক নয়।"});
 req.session.regenerate(err => {
  if (err) return res.status(500).json({error:"Login failed"});
  req.session.user = {id:user.id,name:user.name,email:user.email};
  res.json({ok:true});
 });
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>res.json({ok:true})));

app.get("/api/me", requireUser, (req,res) => {
 const u=req.session.user;
 res.json({user:u,balance:balanceOf(u.id),
  deposits:db.prepare("SELECT id,method,amount,trx_id,status,created_at FROM deposits WHERE user_id=? ORDER BY id DESC LIMIT 30").all(u.id),
  orders:db.prepare("SELECT id,product_name,player_id,amount,status,created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 30").all(u.id)});
});

app.post("/api/deposits", requireUser, (req,res) => {
 const {method,amount,senderNumber,trxId}=req.body||{};
 const n=Number(amount);
 if (!["bkash","nagad"].includes(method) || !Number.isInteger(n) || n<20 || n>50000 ||
     !/^[0-9]{10,14}$/.test(String(senderNumber||"")) || !/^[A-Za-z0-9]{6,24}$/.test(String(trxId||"")))
   return res.status(400).json({error:"পেমেন্টের তথ্য সঠিকভাবে দিন (৳২০–৳৫০,০০০)।"});
 try {
  db.prepare("INSERT INTO deposits(user_id,method,amount,sender_number,trx_id) VALUES(?,?,?,?,?)")
    .run(req.session.user.id,method,n,String(senderNumber),String(trxId).toUpperCase());
  res.json({ok:true,message:"রিকোয়েস্ট জমা হয়েছে। টাকা যাচাই না হওয়া পর্যন্ত ব্যালেন্স যোগ হবে না।"});
 } catch(e) { res.status(400).json({error:"এই Transaction ID আগে জমা হয়েছে অথবা তথ্য ভুল।"}); }
});

app.post("/api/orders", requireUser, (req,res) => {
 const {productId,playerId}=req.body||{};
 const p=products.find(x=>x.id===productId);
 if (!p) return res.status(400).json({error:"পণ্য পাওয়া যায়নি।"});
 if (!p.price) return res.status(400).json({error:"এই সার্ভিসের দাম নিশ্চিত করতে Admin-এর সাথে যোগাযোগ করুন।"});
 if (!/^[0-9]{5,20}$/.test(String(playerId||""))) return res.status(400).json({error:"সঠিক Player ID দিন।"});
 const userId=req.session.user.id;
 const create=db.transaction(()=>{
  if (balanceOf(userId)<p.price) throw new Error("ওয়ালেটে পর্যাপ্ত টাকা নেই।");
  const info=db.prepare("INSERT INTO orders(user_id,product_id,product_name,player_id,amount) VALUES(?,?,?,?,?)")
    .run(userId,p.id,p.name,String(playerId),p.price);
  db.prepare("INSERT INTO wallet_ledger(user_id,amount,type,reference) VALUES(?,?,?,?)")
    .run(userId,-p.price,"purchase","order:"+info.lastInsertRowid);
  return Number(info.lastInsertRowid);
 });
 try { const id=create(); res.json({ok:true,orderId:id,message:"অর্ডার গ্রহণ করা হয়েছে। Admin অর্ডারটি সম্পন্ন করবেন।"}); }
 catch(e) { res.status(400).json({error:e.message||"অর্ডার করা যায়নি।"}); }
});

/* Admin endpoints: set credentials in .env, then sign in from the Admin panel. */
app.post("/api/admin/login",(req,res)=>{
 const {email,password}=req.body||{};
 const expectedEmail=process.env.ADMIN_EMAIL||"";
 const expectedPassword=process.env.ADMIN_PASSWORD||"";
 const safe=(a,b)=>{const aa=Buffer.from(String(a||""));const bb=Buffer.from(String(b||""));return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);};
 if (!expectedEmail || !expectedPassword || !safe(email,expectedEmail) || !safe(password,expectedPassword))
  return res.status(401).json({error:"Admin credentials ভুল। .env ফাইল সেট করুন।"});
 req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Login failed"});req.session.admin=true;res.json({ok:true});});
});
app.get("/api/admin/queue",requireAdmin,(req,res)=>res.json({
 deposits:db.prepare("SELECT d.*,u.email FROM deposits d JOIN users u ON u.id=d.user_id WHERE d.status='pending' ORDER BY d.id").all(),
 orders:db.prepare("SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE o.status='processing' ORDER BY o.id").all()
}));
app.post("/api/admin/deposits/:id/approve",requireAdmin,(req,res)=>{
 const approve=db.transaction(()=>{
  const d=db.prepare("SELECT * FROM deposits WHERE id=?").get(Number(req.params.id));
  if(!d || d.status!=="pending") throw new Error("এই ডিপোজিট আর pending নেই।");
  db.prepare("UPDATE deposits SET status='approved' WHERE id=?").run(d.id);
  db.prepare("INSERT INTO wallet_ledger(user_id,amount,type,reference) VALUES(?,?,?,?)").run(d.user_id,d.amount,"deposit","deposit:"+d.id);
 });
 try{approve();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
app.post("/api/admin/deposits/:id/reject",requireAdmin,(req,res)=>{
 const r=db.prepare("UPDATE deposits SET status='rejected' WHERE id=? AND status='pending'").run(Number(req.params.id));
 res.json({ok:r.changes===1});
});
app.post("/api/admin/orders/:id/complete",requireAdmin,(req,res)=>{
 const r=db.prepare("UPDATE orders SET status='completed' WHERE id=? AND status='processing'").run(Number(req.params.id));
 res.json({ok:r.changes===1});
});
app.post("/api/admin/orders/:id/cancel",requireAdmin,(req,res)=>{
 const cancel=db.transaction(()=>{
  const o=db.prepare("SELECT * FROM orders WHERE id=?").get(Number(req.params.id));
  if(!o || o.status!=="processing") throw new Error("অর্ডারটি pending নেই।");
  db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id);
  db.prepare("INSERT INTO wallet_ledger(user_id,amount,type,reference) VALUES(?,?,?,?)").run(o.user_id,o.amount,"refund","order-refund:"+o.id);
 });
 try{cancel();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=Number(process.env.PORT)||3000;
app.listen(port,()=>console.log(`GY GAMING running on port ${port}`));
