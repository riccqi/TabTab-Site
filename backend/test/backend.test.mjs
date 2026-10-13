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
test('release sending skips opt-outs, prevents duplicates and includes one-click headers',async(t)=>{
  const {env}=setup();const row=await seed(env);const messages=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{messages.push(JSON.parse(options.body));return Response.json({id:'release-1'});});
  const send=()=>worker.fetch(request('/admin/send',{campaign_id:'v1',contact_id:row.id,subject:'New release',text:'Hello <script>'},{Authorization:'Bearer admin-secret'}),env);
  assert.equal((await send()).status,200);await send();assert.equal(messages.length,1);
  assert.equal(messages[0].headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');
  assert.ok(messages[0].html.includes('&lt;script&gt;'));
  await seed(env,{status:'unsubscribed'});await send();assert.equal(messages.length,1);
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
  const login=await (await worker.fetch(dash('/login',{},''),env)).json();assert.equal(mail.to,'owner@example.com');const code=mail.text.match(/\b\d{8}\b/)[0];
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
 const {env,sql}=setup();env.DASHBOARD_EMAIL='owner@example.com';await seed(env);const {runCampaigns}=await import('../src/dashboard-api.mjs');const {sendRelease}=await import('../src/index.mjs');
 const original=globalThis.fetch;let sends=0;globalThis.fetch=async()=>{sends++;return Response.json({id:'test-'+sends});};
 try{
  await worker.fetch(dash('/settings',{postal_address:'PO Box 1, City',daily_limit:100}),env);
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
  await runCampaigns(env,{sendRelease});
  assert.equal(sends,2);assert.equal(sql.prepare("SELECT state FROM campaigns WHERE id='release-test'").get().state,'completed');assert.equal(sql.prepare('SELECT COUNT(*) n FROM campaign_recipients').get().n,1);assert.equal(sql.prepare('SELECT state FROM campaign_recipients').get().state,'skipped');
  const list=await (await worker.fetch(dash('/contacts?q=reader&status=unsubscribed'),env)).json();assert.equal(list.total,1);assert.equal(list.contacts[0].email,'reader@example.com');
 }finally{globalThis.fetch=original;}
});
test('daily quota pauses before provider contact and does not leave a failed delivery lock',async()=>{
 const {env,sql}=setup(),row=await seed(env);const {sendRelease}=await import('../src/index.mjs');
 sql.prepare('INSERT INTO email_usage(day,attempts) VALUES (?,80)').run(new Date().toISOString().slice(0,10));
 const body={campaign_id:'quota',contact_id:row.id,subject:'Update',markdown:'# Hello',preheader:''};
 const original=globalThis.fetch;let sent;globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return Response.json({id:'quota-test'});};
 try{
  await assert.rejects(()=>sendRelease(request('/admin/send',body),env),e=>e.quota===true);assert.equal(sent,undefined);assert.equal(sql.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
  sql.prepare('UPDATE email_usage SET attempts=0').run();await sendRelease(request('/admin/send',body),env);assert.match(sent.html,/<h1/);assert.match(sent.headers['List-Unsubscribe'],/unsubscribe\?token=/);await sendRelease(request('/admin/send',body),env);assert.equal(sql.prepare('SELECT attempts FROM email_usage').get().attempts,1);
 }finally{globalThis.fetch=original;}
});
test('background sender batches within the D1 Free query limit and resumes without duplicate sends',async()=>{
 const {env,sql}=setup();const {runCampaigns}=await import('../src/dashboard-api.mjs'),{sendRelease}=await import('../src/index.mjs');
 const date=new Date().toISOString();sql.prepare("INSERT INTO campaigns(id,subject,markdown,preheader,state,postal_address,created_at,updated_at,started_at) VALUES ('background','Release','# Hello','Preview','sending','PO Box 1',?,?,?)").run(date,date,date);
 for(let i=0;i<7;i++){const row=await seed(env,{email:`reader${i}@example.com`,external_id:String(i)});sql.prepare("INSERT INTO campaign_recipients(campaign_id,contact_id) VALUES ('background',?)").run(row.id);}
 const original=globalThis.fetch;let sent=0;globalThis.fetch=async()=>{sent++;return Response.json({id:'background-'+sent});};
 const prepare=env.DB.prepare;let queries=0;env.DB.prepare=(...args)=>{queries++;return prepare(...args);};
 try{
  await runCampaigns(env,{sendRelease,delay:async()=>{}});assert.equal(sent,6);assert.ok(queries<=50,`Used ${queries} D1 queries`);assert.equal(sql.prepare("SELECT state FROM campaigns WHERE id='background'").get().state,'sending');
  queries=0;await runCampaigns(env,{sendRelease,delay:async()=>{}});assert.equal(sent,7);assert.equal(sql.prepare("SELECT state FROM campaigns WHERE id='background'").get().state,'completed');await runCampaigns(env,{sendRelease,delay:async()=>{}});assert.equal(sent,7);
 }finally{globalThis.fetch=original;}
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
