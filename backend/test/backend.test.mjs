import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/index.mjs';
import { hmac, hex, token } from '../src/crypto.mjs';
import { contactStatements } from '../src/store.mjs';

function setup() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_subscribers.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0002_subscription_basis.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0003_dashboard.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0004_uncapped_sending.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../migrations/0005_shared_outbox.sql',import.meta.url),'utf8'));
  const wrap = (query,args=[]) => ({
    bind(...values){return wrap(query,values);},
    async first(){return sql.prepare(query).get(...args)||null;},
    async all(){return {results:sql.prepare(query).all(...args)};},
    async run(){return sql.prepare(query).run(...args);}
  });
  const DB={prepare:wrap,async batch(statements){sql.exec('BEGIN');try{const r=[];for(const statement of statements)r.push(await statement.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,env:{DB,SITE_ORIGIN:'https://tabtabapp.net',PUBLIC_URL:'https://updates.tabtabapp.net',TURNSTILE_SECRET:'test-turnstile-secret',TOKEN_SECRET:'test-token-secret',ADMIN_TOKEN:'admin-secret',LEMONSQUEEZY_WEBHOOK_SECRET:'lemon-secret',LEMONSQUEEZY_STORE_ID:'1',LEMONSQUEEZY_PRODUCT_IDS:'2',RESEND_API_KEY:'fake',FROM_EMAIL:'TabTab <updates@example.com>',POSTAL_ADDRESS:'Test address',RESEND_WEBHOOK_SECRET:'whsec_dGVzdA==',SIGNUP_LIMITER:{limit:async()=>({success:true})}}};
}
const request=(path,body,headers={})=>new Request(`https://updates.tabtabapp.net${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const contact=(extra={})=>({email:'reader@example.com',name:'Reader',source:'formspree',external_id:'1',status:'subscribed',consent_at:'2026-01-01T00:00:00Z',consent_source:'Website signup',...extra});
const unlock=sql=>sql.exec('UPDATE send_lock SET next_at=0');
// Mock Resend: batch requests get one id per email; single sends get one id.
function mockResend(handler){const original=globalThis.fetch,calls=[];globalThis.fetch=async(url,options)=>{const call={url:String(url),key:options.headers['Idempotency-Key'],body:JSON.parse(options.body)};calls.push(call);if(handler)return handler(call);return call.url.endsWith('/emails/batch')?Response.json({data:call.body.map((_,i)=>({id:`id-${calls.length}-${i}`}))}):Response.json({id:`id-${calls.length}`});};return {calls,restore:()=>{globalThis.fetch=original;}};}
async function startCampaign(env,sql,count,id='background'){
 const date=new Date().toISOString();sql.prepare("INSERT INTO campaigns(id,subject,markdown,preheader,state,postal_address,created_at,updated_at,started_at) VALUES (?,'Release','# Hello <script>','Preview','sending','PO Box 1',?,?,?)").run(id,date,date,date);
 for(let i=0;i<count;i++){const row=await seed(env,{email:`reader${i}@${id}.example.com`,external_id:id+i});sql.prepare("INSERT INTO deliveries(id,campaign_id,contact_id,kind,available_at) VALUES (?,?,?,'announcement',0)").run(`${id}-${String(i).padStart(4,'0')}`,id,row.id);}
}
async function seed(env,extra={}){await env.DB.batch(contactStatements(env.DB,contact(extra)));return env.DB.prepare('SELECT * FROM contacts WHERE email=?').bind(extra.email||'reader@example.com').first();}

test('merges emails and preserves unsubscribe/suppression against purchases and imports',async()=>{
  const {sql,env}=setup();
  await seed(env,{email:'READER@example.com'});
  await seed(env,{source:'lemonsqueezy',external_id:'order-1',status:'customer'});
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM contacts').get().n,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM contact_sources').get().n,2);
  await seed(env,{status:'unsubscribed'});await seed(env);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'unsubscribed');
  await seed(env,{status:'suppressed'});await seed(env,{status:'unsubscribed'});
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'suppressed');
});
test('signed purchase webhook ignores tests, other stores/products, and rejects forged payloads',async()=>{
  const {sql,env}=setup();
  const payload={meta:{event_name:'order_created'},data:{type:'orders',id:'99',attributes:{test_mode:false,store_id:1,status:'paid',first_order_item:{product_id:2},user_email:'buyer@example.com',user_name:'Buyer'}}};
  const signed=async p=>{const raw=JSON.stringify(p);return request('/webhooks/lemonsqueezy',raw,{'x-signature':hex(await hmac(env.LEMONSQUEEZY_WEBHOOK_SECRET,raw))});};
  assert.equal((await worker.fetch(request('/webhooks/lemonsqueezy',payload),env)).status,401);
  for(const change of [{test_mode:true},{store_id:3},{first_order_item:{product_id:7}}]){
    const p=structuredClone(payload);Object.assign(p.data.attributes,change);
    assert.equal((await worker.fetch(await signed(p),env)).status,200);
  }
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM contacts').get().n,0);
  await worker.fetch(await signed(payload),env);await worker.fetch(await signed(payload),env);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM contacts').get().n,1);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'customer');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM webhook_events').get().n,1);
  env.LEMONSQUEEZY_CUSTOMER_UPDATES='true';
  payload.data.id='100';payload.data.attributes.user_email='new-buyer@example.com';
  await worker.fetch(await signed(payload),env);
  const buyer=sql.prepare('SELECT * FROM contacts WHERE email=?').get('new-buyer@example.com');
  assert.equal(buyer.status,'subscribed');assert.equal(buyer.consent_at,null);
  assert.equal(buyer.subscription_basis,'customer_release_updates');
  sql.prepare("UPDATE contacts SET status='unsubscribed' WHERE id=?").run(buyer.id);
  payload.data.id='101';await worker.fetch(await signed(payload),env);
  assert.equal(sql.prepare('SELECT status FROM contacts WHERE id=?').get(buyer.id).status,'unsubscribed');
});
test('unsubscribe GET is safe for scanners; POST persists and invalidates confirmation',async()=>{
  const {env,sql}=setup();const row=await seed(env);
  sql.prepare('UPDATE contacts SET confirmation_nonce=?').run('old');
  const value=await token(env.TOKEN_SECRET,{id:row.id,purpose:'unsubscribe'});
  const path=`/unsubscribe?token=${value}`;
  assert.equal((await worker.fetch(request(path),env)).status,200);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'subscribed');
  await worker.fetch(request(path,'List-Unsubscribe=One-Click',{'Content-Type':'application/x-www-form-urlencoded'}),env);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'unsubscribed');
  const stale=await token(env.TOKEN_SECRET,{id:row.id,purpose:'confirm',nonce:'old',exp:Date.now()+10000});
  assert.equal((await worker.fetch(request(`/confirm?token=${stale}`,''),env)).status,400);
  assert.equal((await worker.fetch(request(`/unsubscribe?token=${value}x`,''),env)).status,400);
});
test('signup activates immediately without email, preserves suppression, and supports explicit resubscribe',async(t)=>{
  const {env,sql}=setup();let sends=0;
  t.mock.method(globalThis,'fetch',async url=>{if(url==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:true,hostname:'tabtabapp.net',action:'signup'});sends++;throw new Error('Signup must not send email');});
  const signup=()=>worker.fetch(request('/subscribe',{email:'reader@example.com',consent:'yes','cf-turnstile-response':'valid-token'},{Origin:env.SITE_ORIGIN}),env);
  assert.equal((await signup()).status,200);
  const first=sql.prepare('SELECT * FROM contacts').get();
  assert.equal(first.status,'subscribed');assert.equal(first.consent_source,'website-single-opt-in');
  assert.equal(first.subscription_basis,'website_single_opt_in');assert.equal(first.confirmation_nonce,null);
  await signup();assert.equal(sql.prepare('SELECT consent_at FROM contacts').get().consent_at,first.consent_at);
  await seed(env,{status:'unsubscribed'});await signup();assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'subscribed');
  await seed(env,{status:'suppressed'});await signup();assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'suppressed');
  assert.equal(sends,0);
});
test('signup rejects wrong origins and oversized bodies; API admin access is private',async()=>{
  const {env}=setup();
  assert.equal((await worker.fetch(request('/subscribe',{email:'x@example.com',consent:'yes'}),env)).status,403);
  assert.equal((await worker.fetch(request('/subscribe','x'.repeat(5000),{Origin:env.SITE_ORIGIN}),env)).status,413);
  assert.equal((await worker.fetch(request('/admin/contacts'),env)).status,401);
  const response=await worker.fetch(request('/admin/contacts',undefined,{Authorization:'Bearer admin-secret'}),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.has('Access-Control-Allow-Origin'),false);
});
test('the legacy one-off send endpoint is gone; campaigns are the only bulk sending path',async()=>{
  const {env}=setup();const row=await seed(env);
  const response=await worker.fetch(request('/admin/send',{campaign_id:'v1',contact_id:row.id,subject:'New release',text:'Hello'},{Authorization:'Bearer admin-secret'}),env);
  assert.equal(response.status,404);
});

test('Resend suppression webhook is signed and refuses stale timestamps',async()=>{
 for (const from of ['TabTab <updates@tabtabapp.net>','TabTab <richard@tabtabapp.net>','richard@tabtabapp.net']) {
  const {env,sql}=setup();await seed(env);
  const raw=JSON.stringify({type:'email.complained',data:{from,to:['reader@example.com']}});
  const signed=async timestamp=>request('/webhooks/resend',raw,{'svix-id':'evt-1','svix-timestamp':String(timestamp),'svix-signature':`v1,${Buffer.from(await hmac(new TextEncoder().encode('test'),`evt-1.${timestamp}.${raw}`)).toString('base64')}`});
  assert.equal((await worker.fetch(await signed(1),env)).status,401);
  assert.equal((await worker.fetch(await signed(Math.floor(Date.now()/1000)),env)).status,200);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'suppressed');
 }
});

test('shared Resend events from OpenCam cannot suppress TabTab subscribers',async()=>{
  const {env,sql}=setup();await seed(env);
  for(const from of ['updates@opencam.app','OpenCam <updates@opencam.app>','richard@opencam.app','OpenCam <richard@opencam.app>','']) {
    const raw=JSON.stringify({type:'email.complained',data:{from,to:['reader@example.com']}}),timestamp=Math.floor(Date.now()/1000);
    const signature=Buffer.from(await hmac(new TextEncoder().encode('test'),`evt-other.${timestamp}.${raw}`)).toString('base64');
    const response=await worker.fetch(request('/webhooks/resend',raw,{'svix-id':'evt-other','svix-timestamp':String(timestamp),'svix-signature':`v1,${signature}`}),env);
    assert.equal(response.status,200);assert.equal((await response.json()).ignored,true);
    assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'subscribed');
  }
});

// Dashboard and background delivery regressions use the same real SQLite adapter.
const dash=(path,body,auth='admin-secret')=>new Request('https://updates.tabtabapp.net/dashboard/api'+path,{method:body===undefined?'GET':'POST',headers:{Origin:'https://updates.tabtabapp.net','X-TabTab-Dashboard':'1','Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('dashboard protects data, prevents cross-origin mutations, and uses one-time owner login codes',async()=>{
 const {env}=setup();env.DASHBOARD_EMAIL='owner@example.com';const original=globalThis.fetch;let mail;
 globalThis.fetch=async(_url,options)=>{mail=JSON.parse(options.body);return Response.json({id:'login-email'});};
 try{
  assert.equal((await worker.fetch(dash('/overview',undefined,''),env)).status,401);
  const denied=new Request('https://updates.tabtabapp.net/dashboard/api/settings',{method:'POST',headers:{Authorization:'Bearer admin-secret',Origin:'https://evil.example'},body:'{}'});
  assert.equal((await worker.fetch(denied,env)).status,403);
  const login=await (await worker.fetch(dash('/login',{},''),env)).json();assert.deepEqual(mail.to,['owner@example.com']);const code=mail.text.match(/\b\d{8}\b/)[0];
  assert.equal((await worker.fetch(dash('/verify',{id:login.id,code:'11111111'},''),env)).status,401);
  const verified=await worker.fetch(dash('/verify',{id:login.id,code},''),env);assert.equal(verified.status,200);const cookie=verified.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await worker.fetch(dash('/verify',{id:login.id,code},''),env)).status,401);
  const req=new Request('https://updates.tabtabapp.net/dashboard/api/overview',{headers:{Cookie:cookie.split(';')[0]}});assert.equal((await worker.fetch(req,env)).status,200);
  const logout=new Request('https://updates.tabtabapp.net/dashboard/api/logout',{method:'POST',headers:{Cookie:cookie.split(';')[0],Origin:'https://updates.tabtabapp.net','X-TabTab-Dashboard':'1'}});assert.equal((await worker.fetch(logout,env)).status,200);assert.equal((await worker.fetch(req,env)).status,401);
 }finally{globalThis.fetch=original;}
});
test('Markdown renderer escapes raw HTML and unsafe URLs while preserving useful email markup',async()=>{
 const {renderEmail}=await import('../src/email-template.mjs');
 const {html}=renderEmail({subject:'<script>alert(1)</script>',markdown:'# Hello\n\n**Bold** and [safe](https://example.com).\n\n[bad](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n![image](https://example.com/a.png)\n\n| A | B |\n|---|---|\n| 1 | 2 |',postalAddress:'Address <test>'});
 assert.match(html,/<strong>Bold<\/strong>/);assert.match(html,/href="https:\/\/example.com\//);assert.doesNotMatch(html,/<script|href="javascript:|<img src=x/);assert.match(html,/&lt;img/);assert.match(html,/<th /);assert.match(html,/Address &lt;test&gt;/);
});
test('drafts require an exact-content test, snapshot audience, lock content, and respect later opt-outs',async()=>{
 const {env,sql}=setup();env.DASHBOARD_EMAIL='owner@example.com';await seed(env);const {drain}=await import('../src/outbox.mjs');
 const resend=mockResend();
 try{
  await worker.fetch(dash('/settings',{postal_address:'PO Box 1, City'}),env);
  const d={id:'release-test',subject:'A release',markdown:'# Hello\n\n**New things**',preheader:'Fresh improvements'};
  assert.equal((await worker.fetch(dash('/campaign',d),env)).status,200);
  assert.equal((await worker.fetch(dash('/campaign/release-test/start',{confirmation:d.subject}),env)).status,400);
  await worker.fetch(dash('/campaign/release-test/test',{email:'owner@example.com'}),env);
  const edited={...d,markdown:d.markdown+'!'};await worker.fetch(dash('/campaign',edited),env);
  assert.equal((await worker.fetch(dash('/campaign/release-test/start',{confirmation:d.subject}),env)).status,400);
  await worker.fetch(dash('/campaign/release-test/test',{email:'owner@example.com'}),env);
  assert.equal((await worker.fetch(dash('/campaign/release-test/start',{confirmation:d.subject}),env)).status,200);
  assert.equal((await worker.fetch(dash('/campaign/release-test/start',{confirmation:d.subject}),env)).status,409);
  assert.equal((await worker.fetch(dash('/campaign',d),env)).status,409);
  await seed(env,{email:'later@example.com',external_id:'later'});
  sql.prepare("UPDATE contacts SET status='unsubscribed' WHERE email='reader@example.com'").run();
  await drain(env);
  assert.equal(resend.calls.length,2);assert.equal(sql.prepare("SELECT COUNT(*) n FROM deliveries").get().n,1);assert.equal(sql.prepare('SELECT status,error_code FROM deliveries').get().error_code,'not_subscribed');
  const overview=await (await worker.fetch(dash('/overview'),env)).json();assert.equal(overview.campaigns[0].state,'completed');assert.equal(overview.campaigns[0].skipped,1);
  const list=await (await worker.fetch(dash('/contacts?q=reader&status=unsubscribed'),env)).json();assert.equal(list.total,1);assert.equal(list.contacts[0].email,'reader@example.com');
 }finally{resend.restore();}
});
test('webhook acceptance events settle a held delivery, but only for TabTab mail',async()=>{
 const {env,sql}=setup();await startCampaign(env,sql,1,'held');sql.prepare("UPDATE deliveries SET status='ambiguous',error_code='transport_uncertain'").run();
 const post=async event=>{const raw=JSON.stringify(event),timestamp=Math.floor(Date.now()/1000),id='evt-'+Math.random();const signature=Buffer.from(await hmac(new TextEncoder().encode('test'),`${id}.${timestamp}.${raw}`)).toString('base64');return worker.fetch(request('/webhooks/resend',raw,{'svix-id':id,'svix-timestamp':String(timestamp),'svix-signature':`v1,${signature}`}),env);};
 const event=from=>({type:'email.delivered',data:{from,email_id:'resend-1',to:['reader0@held.example.com'],tags:[{name:'app',value:'tabtab'},{name:'delivery_id',value:'held-0000'}]}});
 assert.equal((await (await post(event('OpenCam <richard@opencam.app>'))).json()).ignored,true);assert.equal(sql.prepare('SELECT status FROM deliveries').get().status,'ambiguous');
 assert.equal((await post(event('TabTab <richard@tabtabapp.net>'))).status,200);
 assert.deepEqual({...sql.prepare('SELECT status,message_id FROM deliveries').get()},{status:'sent',message_id:'resend-1'});
});

test('shared outbox sends 100 per minute in one batch within the D1 Free query limit, without duplicates',async()=>{
 const {env,sql}=setup();const {drain}=await import('../src/outbox.mjs');await startCampaign(env,sql,105);
 const resend=mockResend(),prepare=env.DB.prepare;let queries=0;env.DB.prepare=(...args)=>{queries++;return prepare(...args);};
 try{
  await drain(env);assert.equal(resend.calls.length,1);assert.ok(queries<=50,`Used ${queries} D1 queries`);
  const batch=resend.calls[0].body;assert.match(resend.calls[0].url,/\/emails\/batch$/);assert.equal(batch.length,100);assert.equal(new Set(batch.map(m=>m.to[0])).size,100);
  assert.ok(batch.every(m=>m.from==='TabTab <updates@example.com>'&&m.tags.some(t=>t.name==='app'&&t.value==='tabtab')&&m.headers['List-Unsubscribe-Post']==='List-Unsubscribe=One-Click'&&m.html.includes(m.headers['List-Unsubscribe'].slice(1,-1))&&!m.html.includes('<script>')));
  assert.equal(new Set(batch.map(m=>m.headers['List-Unsubscribe'])).size,100);
  await drain(env);assert.equal(resend.calls.length,1,'one batch per minute');
  unlock(sql);await drain(env);assert.equal(resend.calls.length,2);assert.equal(resend.calls[1].body.length,5);
  unlock(sql);await drain(env);assert.equal(resend.calls.length,2);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='sent' AND message_id IS NOT NULL").get().n,105);
  const overview=await (await worker.fetch(dash('/overview'),env)).json();assert.equal(overview.usage,105);assert.deepEqual([overview.campaigns[0].state,overview.campaigns[0].sent,overview.campaigns[0].remaining],['completed',105,0]);
 }finally{resend.restore();env.DB.prepare=prepare;}
});

test('Resend throttling retries with backoff, uncertain outcomes are held, and paused campaigns are not claimed',async()=>{
 const {env,sql}=setup();const {drain}=await import('../src/outbox.mjs');await startCampaign(env,sql,3,'throttle');
 let status=429;const resend=mockResend(()=>new Response('{}',{status}));
 try{
  await drain(env);assert.equal(resend.calls.length,1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='retry' AND attempts=1 AND available_at>unixepoch()").get().n,3);
  unlock(sql);await drain(env);assert.equal(resend.calls.length,1,'backoff holds the retry');
  sql.prepare('UPDATE deliveries SET available_at=0').run();status=502;unlock(sql);await drain(env);assert.equal(resend.calls.length,2);
  assert.equal(resend.calls[0].key,resend.calls[1].key,'same payload keeps the same idempotency key');
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='ambiguous'").get().n,3);
  unlock(sql);await drain(env);assert.equal(resend.calls.length,2,'uncertain outcomes are never resent automatically');
  await startCampaign(env,sql,2,'paused');sql.prepare("UPDATE campaigns SET state='paused' WHERE id='paused'").run();
  unlock(sql);await drain(env);assert.equal(resend.calls.length,2);assert.equal(sql.prepare("SELECT COUNT(*) n FROM deliveries WHERE campaign_id='paused' AND status='queued' AND attempts=0").get().n,2);
 }finally{resend.restore();}
});

test('Turnstile rejects missing, forged, expired, wrong-host and wrong-action tokens before storing a contact',async(t)=>{
 const {env,sql}=setup();const submit=challenge=>worker.fetch(request('/subscribe',{email:'bot@example.com',consent:'yes','cf-turnstile-response':challenge},{Origin:env.SITE_ORIGIN}),env);
 let reply={success:false,'error-codes':['timeout-or-duplicate']},outage=false;
 t.mock.method(globalThis,'fetch',async()=>{if(outage)throw new Error('Network unavailable');return Response.json(reply);});
 for(const challenge of [undefined,'','x'.repeat(2049),'forged'])assert.equal((await submit(challenge)).status,400);
 for(const data of [{success:true,hostname:'opencam.app',action:'signup'},{success:true,hostname:'tabtabapp.net',action:'login'}]){reply=data;assert.equal((await submit('valid')).status,400);}
 outage=true;assert.equal((await submit('valid')).status,503);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM contacts').get().n,0);
});

test('central studio credential is dashboard-only and legacy dashboard logins are disabled',async()=>{
 const {env}=setup();env.STUDIO_URL='https://updates-api.opencam.app/dashboard?app=tabtab';env.SHARED_STUDIO_TOKEN='shared-studio-test-secret';
 const redirect=await worker.fetch(request('/dashboard'),env);assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),env.STUDIO_URL);
 assert.equal((await worker.fetch(dash('/overview',undefined,''),env)).status,401);
 assert.equal((await worker.fetch(dash('/overview'),env)).status,401);
 assert.equal((await worker.fetch(dash('/login',{},''),env)).status,401);
 assert.equal((await worker.fetch(dash('/overview',undefined,env.SHARED_STUDIO_TOKEN),env)).status,200);
 assert.equal((await worker.fetch(dash('/login',{},env.SHARED_STUDIO_TOKEN),env)).status,404);
 const draft={id:'central-test',subject:'Only TabTab',markdown:'Hello TabTab',preheader:''};
 assert.equal((await worker.fetch(dash('/campaign',draft,env.SHARED_STUDIO_TOKEN),env)).status,200);
 const overview=await(await worker.fetch(dash('/overview',undefined,env.SHARED_STUDIO_TOKEN),env)).json();assert.equal(overview.campaigns[0].id,draft.id);
 assert.equal((await worker.fetch(request('/admin/contacts',undefined,{Authorization:'Bearer '+env.SHARED_STUDIO_TOKEN}),env)).status,401);
 const cross=new Request('https://updates.tabtabapp.net/dashboard/api/settings',{method:'POST',headers:{Authorization:'Bearer '+env.SHARED_STUDIO_TOKEN,Origin:'https://evil.example','X-TabTab-Dashboard':'1'},body:'{}'});assert.equal((await worker.fetch(cross,env)).status,403);
});

test('a concurrent draft edit cannot bypass exact-content test before launch',async()=>{
 const {env,sql}=setup();await seed(env);
 await worker.fetch(dash('/settings',{postal_address:'Test address'}),env);
 const d={id:'concurrent-edit',subject:'Tested subject',markdown:'Tested body',preheader:''};
 await worker.fetch(dash('/campaign',d),env);
 const {sha256}=await import('../src/crypto.mjs');
 const {settings}=await import('../src/dashboard-api.mjs');const config=await settings(env);
 sql.prepare('UPDATE campaigns SET test_hash=? WHERE id=?').run(await sha256(JSON.stringify([d.subject,d.markdown,d.preheader,config.postal_address])),d.id);
 const batch=env.DB.batch;
 env.DB.batch=async statements=>{sql.prepare("UPDATE campaigns SET subject='Untested edit',test_hash=NULL WHERE id=?").run(d.id);return batch(statements);};
 const result=await worker.fetch(dash('/campaign/'+d.id+'/start',{confirmation:d.subject}),env);
 assert.equal(result.status,409);assert.equal(sql.prepare('SELECT state FROM campaigns WHERE id=?').get(d.id).state,'draft');assert.equal(sql.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
});

test('settings only hold the mailing address; there is no sending plan or daily cap',async()=>{
 const {env,sql}=setup();
 assert.equal((await worker.fetch(dash('/settings',{postal_address:'PO Box 1, City'}),env)).status,200);
 assert.equal(sql.prepare('SELECT postal_address FROM dashboard_settings').get().postal_address,'PO Box 1, City');
 assert.equal((await worker.fetch(dash('/settings',{postal_address:42}),env)).status,400);
 const overview=await (await worker.fetch(dash('/overview'),env)).json();assert.deepEqual(overview.settings,{postal_address:'PO Box 1, City'});assert.equal(overview.usage,0);
});

test('subscriber list shows when and how each contact was added, and when they unsubscribed',async()=>{
 const {env}=setup();const row=await seed(env);await seed(env,{source:'lemonsqueezy',external_id:'order-1',status:'customer'});
 const listed=async status=>(await (await worker.fetch(dash('/contacts?q=reader&status='+status),env)).json()).contacts[0];
 const added=await listed('subscribed');assert.equal(added.added_via,'formspree');assert.ok(Date.parse(added.added_at));assert.deepEqual(added.sources.split(',').sort(),['formspree','lemonsqueezy']);assert.equal(added.unsubscribed_at,null);
 await worker.fetch(dash('/unsubscribe',{id:row.id}),env);
 const gone=await listed('unsubscribed');assert.ok(Date.parse(gone.unsubscribed_at));assert.equal(gone.added_at,added.added_at);
});
