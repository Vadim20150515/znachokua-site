// ЗначокUA: сайт, підключений до Google Apps Script-бота. Без залежностей, Node 18+.
const http=require("http"),fs=require("fs"),path=require("path"),crypto=require("crypto");
try{for(const l of fs.readFileSync(path.join(__dirname,"settings.env"),"utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);if(m&&!l.trim().startsWith("#")&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,"")}}catch{}
const PORT=process.env.PORT||3000,ADMIN_EMAIL=(process.env.ADMIN_EMAIL||"").toLowerCase(),ADMIN_PASSWORD=process.env.ADMIN_PASSWORD,BOT_API_URL=process.env.BOT_API_URL,SITE_KEY=process.env.SITE_KEY;
if(!ADMIN_EMAIL||!ADMIN_PASSWORD||!BOT_API_URL||!SITE_KEY||/ВСТАВТЕ/.test(ADMIN_PASSWORD+BOT_API_URL+SITE_KEY)){console.error("Відкрийте файл settings.env у блокноті та впишіть пароль, BOT_API_URL і SITE_KEY");process.exit(1)}
const DB_FILE=process.env.DB_FILE||path.join(__dirname,"data.json");
let db={meta:{},tickets:[],keys:{},settings:{open:1,desc:"Яскраві значки з українським характером.",contacts:""}};
try{Object.assign(db,JSON.parse(fs.readFileSync(DB_FILE,"utf8")))}catch{}
const save=()=>{fs.writeFileSync(DB_FILE+".tmp",JSON.stringify(db));fs.renameSync(DB_FILE+".tmp",DB_FILE)};
const eq=(a,b)=>crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(),crypto.createHash("sha256").update(String(b)).digest());
const now=()=>new Date().toLocaleString("uk-UA"),nickOf=s=>String(s||"").trim().replace(/^@/,"").toLowerCase(),d10=s=>String(s||"").replace(/\D/g,"").slice(-10);
/* зв'язок із ботом (Google Apps Script) */
async function bot(action,data={}){
 const r=await fetch(BOT_API_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({site_key:SITE_KEY,action,...data}),redirect:"follow"});
 const t=await r.text();let j;try{j=JSON.parse(t)}catch{throw new Error("Бот не відповів (відповідь скрипта: «"+t.replace(/\s+/g," ").slice(0,70)+"»). Перевірте BOT_API_URL, SITE_KEY і нове розгортання")}
 if(!j.ok)throw new Error(j.error||"Помилка бота");return j}
let pc={t:0,v:[]};
const products=async()=>{if(Date.now()-pc.t<15000)return pc.v;const r=await bot("products");pc={t:Date.now(),v:r.products};return pc.v};
const withMeta=p=>{const m=db.meta[p.id]||{};return{id:p.id,name:p.name,price:p.price,on:p.on,emoji:m.emoji||"⭐",color:m.color||"#4b3df2",img:m.img||""}};
const IMG=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;
const cleanProducts=a=>(Array.isArray(a)?a:[]).slice(0,200).map(p=>({id:+p.id||Date.now(),name:String(p.name||"").slice(0,60),price:Math.max(1,Math.round(+p.price||0)),emoji:String(p.emoji||"⭐").slice(0,8),color:/^#[0-9a-f]{6}$/i.test(p.color)?p.color:"#4b3df2",img:typeof p.img==="string"&&p.img.length<300000&&IMG.test(p.img)?p.img:"",on:p.on?1:0})).filter(p=>p.name);
async function syncProducts(list){
 const cur=(await bot("products")).products,byId=new Map(cur.map(p=>[p.id,p])),seen=new Set(),out=[];
 for(const p of cleanProducts(list)){
  let id=p.id;const c=byId.get(id);
  if(c){if(c.price!==p.price)await bot("product_price",{id,price:p.price});if(!!c.on!==!!p.on)await bot("product_active",{id,on:p.on})}
  else{id=(await bot("product_add",{name:p.name,price:p.price})).id;if(!p.on)await bot("product_active",{id,on:0})}
  seen.add(id);db.meta[id]={emoji:p.emoji,color:p.color,img:p.img};out.push(withMeta({...p,id}))}
 for(const c of cur)if(!seen.has(c.id)&&c.on)await bot("product_active",{id:c.id,on:0});
 pc.t=0;save();return out}
const orderView=o=>({id:o.id,name:o.full_name,tg:o.username,phone:"",note:o.comment,items:[{n:o.product,q:o.qty,p:Math.round(o.price/(o.qty||1))}],sum:o.price,status:0,stext:o.status,date:o.created,log:[]});
/* HTTP */
const sessions=new Map(),fails=new Map();
const json=(res,code,obj)=>{res.writeHead(code,{"Content-Type":"application/json"});res.end(JSON.stringify(obj))};
const body=req=>new Promise((ok,no)=>{let b="";req.on("data",c=>{b+=c;if(b.length>3e7){no(new Error("big"));req.destroy()}});req.on("end",()=>{try{ok(b?JSON.parse(b):{})}catch{no(new Error("bad json"))}})});
const pub=()=>({open:db.settings.open,desc:db.settings.desc,contacts:db.settings.contacts});
async function api(req,res,url){
 const m=req.method,p=url.pathname;
 if(m==="GET"&&p==="/api/shop")return json(res,200,{products:(await products()).filter(x=>x.on).map(withMeta),settings:pub()});
 if(m==="POST"&&p==="/api/orders"){
  const b=await body(req);if(!db.settings.open)return json(res,400,{error:"Магазин зараз закритий"});
  if(b.key&&db.keys[b.key])return json(res,200,db.keys[b.key]);
  const tg=nickOf(b.tg);if(!String(b.name||"").trim()||!/^[a-z0-9_]{5,32}$/.test(tg))return json(res,400,{error:"Вкажіть ім’я та нікнейм Telegram (наприклад @vadym)"});
  const dl=b.delivery==="pickup"?"pickup":"np",city=String(b.city||"").trim().slice(0,60),addr=String(b.address||"").trim().slice(0,150);
  if(dl==="np"&&(city.length<2||addr.length<2))return json(res,400,{error:"Вкажіть місто та відділення або адресу"});
  const items=(b.items||[]).slice(0,30).filter(i=>+i.q>0);if(!items.length)return json(res,400,{error:"Кошик порожній"});
  const comment=`Доставка: ${dl==="np"?"Нова пошта, "+city+", "+addr:"самовивіз"}. Оплата: ${b.pay==="card"?"переказ на картку":"при отриманні"}.`+(d10(b.phone)?" Тел: +"+d10(b.phone)+".":"")+(String(b.note||"").trim()?" Коментар: "+String(b.note).trim().slice(0,300):"");
  const ids=[];let notified=false;
  for(const it of items){const r=await bot("order",{product_id:+it.id,qty:Math.min(999,Math.floor(+it.q)),username:tg,name:String(b.name).trim().slice(0,60),comment,design:String(b.design||"").trim()});ids.push(r.id);notified=notified||r.notified}
  const out={id:ids.join(", "),notified};if(b.key){db.keys[b.key]=out;save()}return json(res,200,out)}
 if(m==="POST"&&p==="/api/lookup"){const b=await body(req),n=nickOf(b.phone);if(!/^[a-z0-9_]{5,32}$/.test(n))return json(res,400,{error:"Введіть нікнейм Telegram, наприклад @vadym"});
  const r=await bot("lookup",{username:n});return json(res,200,{orders:r.orders.map(orderView).map(({id,items,sum,stext,date})=>({id,items,sum,status:0,stext,date,log:[]}))})}
 if(m==="POST"&&p==="/api/tickets"){const b=await body(req),tg=nickOf(b.tg);if(tg.length<5||!String(b.text||"").trim())return json(res,400,{error:"Вкажіть нікнейм і повідомлення"});
  const t={id:db.tickets.length+1,tg,text:String(b.text).slice(0,1000),reply:"",date:now()};db.tickets.push(t);save();await bot("support",{username:tg,text:t.text}).catch(()=>{});return json(res,200,{id:t.id})}
 if(m==="POST"&&p==="/api/login"){const ip=req.socket.remoteAddress,f=fails.get(ip)||{n:0,t:0};if(f.n>=5&&Date.now()-f.t<6e5)return json(res,429,{error:"Забагато спроб. Зачекайте 10 хвилин"});
  const b=await body(req);if(String(b.email||"").toLowerCase()===ADMIN_EMAIL&&eq(b.password,ADMIN_PASSWORD)){fails.delete(ip);const t=crypto.randomBytes(24).toString("hex");sessions.set(t,Date.now()+432e5);return json(res,200,{token:t})}
  fails.set(ip,{n:f.n+1,t:Date.now()});return json(res,401,{error:"Невірний пароль"})}
 if(p.startsWith("/api/admin/")){
  const t=(req.headers.authorization||"").slice(7);if(!sessions.has(t)||sessions.get(t)<Date.now())return json(res,401,{error:"Увійдіть знову"});
  if(m==="GET"&&p==="/api/admin/state"){const[pr,or]=await Promise.all([bot("products"),bot("orders")]);return json(res,200,{products:pr.products.map(withMeta),orders:or.orders.map(orderView),tickets:db.tickets,settings:{...pub(),botOn:true,botName:"Google Apps Script"}})}
  if(m==="PUT"&&p==="/api/admin/sync"){const b=await body(req),s=b.settings||{};db.settings={open:s.open?1:0,desc:String(s.desc||"").slice(0,300),contacts:String(s.contacts||"").slice(0,200)};const out=await syncProducts(b.products);return json(res,200,{ok:1,products:out})}
  let k;if(m==="PUT"&&(k=p.match(/^\/api\/admin\/tickets\/(\d+)$/))){const b=await body(req),t=db.tickets.find(t=>t.id===+k[1]);if(!t||!String(b.reply||"").trim())return json(res,400,{error:"Невірні дані"});t.reply=String(b.reply).slice(0,1000);save();await bot("message",{username:t.tg,text:t.reply}).catch(()=>{});return json(res,200,{ok:1})}
 }
 json(res,404,{error:"Не знайдено"})}
http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,"http://x");
  if(url.pathname.startsWith("/api/"))return await api(req,res,url);
  const f=path.join(__dirname,"public",url.pathname==="/"?"index.html":path.normalize(url.pathname).replace(/^(\.\.[\/\\])+/,""));
  if(!f.startsWith(path.join(__dirname,"public"))||!fs.existsSync(f)||fs.statSync(f).isDirectory())return json(res,404,{error:"Не знайдено"});
  res.writeHead(200,{"Content-Type":f.endsWith(".html")?"text/html; charset=utf-8":"application/octet-stream"});fs.createReadStream(f).pipe(res)
 }catch(e){if(!res.headersSent)json(res,e.message&&e.message.startsWith("Бот")?502:400,{error:e.message&&e.message.startsWith("Бот")?e.message:"Помилка запиту"})}
}).listen(PORT,()=>console.log("ЗначокUA: http://localhost:"+PORT));
