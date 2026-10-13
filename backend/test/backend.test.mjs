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
  const wrap = (query,args=[]) => ({
    bind(...values){return wrap(query,values);},
    async first(){return sql.prepare(query).get(...args)||null;},
    async all(){return {results:sql.prepare(query).all(...args)};},
    async run(){return sql.prepare(query).run(...args);}
  });
  const DB={prepare:wrap,async batch(statements){sql.exec('BEGIN');try{const r=[];for(const statement of statements)r.push(await statement.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return {sql,env:{DB,SITE_ORIGIN:'https://tabtabapp.net',PUBLIC_URL:'https://updates.tabtabapp.net',TOKEN_SECRET:'test-token-secret',ADMIN_TOKEN:'admin-secret',LEMONSQUEEZY_WEBHOOK_SECRET:'lemon-secret',LEMONSQUEEZY_STORE_ID:'1',LEMONSQUEEZY_PRODUCT_IDS:'2',RESEND_API_KEY:'fake',FROM_EMAIL:'TabTab <updates@example.com>',POSTAL_ADDRESS:'Test address',RESEND_WEBHOOK_SECRET:'whsec_dGVzdA==',SIGNUP_LIMITER:{limit:async()=>({success:true})}}};
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
test('signup confirms ownership, throttles repeat email requests and supports explicit resubscribe',async(t)=>{
  const {env,sql}=setup();const messages=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{messages.push(JSON.parse(options.body));return Response.json({id:'mail-1'});});
  const signup=()=>worker.fetch(request('/subscribe',{email:'reader@example.com',consent:'yes'},{Origin:env.SITE_ORIGIN}),env);
  assert.equal((await signup()).status,200);await signup();assert.equal(messages.length,1);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'pending');
  const link=messages[0].text.match(/https:\/\/\S+/)[0];
  await worker.fetch(new Request(link),env);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'pending');
  assert.equal((await worker.fetch(new Request(link,{method:'POST'}),env)).status,200);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'subscribed');
  assert.equal((await worker.fetch(new Request(link,{method:'POST'}),env)).status,400);
  await seed(env,{status:'unsubscribed'});sql.prepare('UPDATE contacts SET confirmation_sent_at=NULL').run();
  await signup();assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'unsubscribed');
  const next=messages[1].text.match(/https:\/\/\S+/)[0];await worker.fetch(new Request(next,{method:'POST'}),env);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'subscribed');
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
  const {env,sql}=setup();await seed(env);
  const raw=JSON.stringify({type:'email.complained',data:{to:['reader@example.com']}});
  const signed=async timestamp=>request('/webhooks/resend',raw,{'svix-id':'evt-1','svix-timestamp':String(timestamp),'svix-signature':`v1,${Buffer.from(await hmac(new TextEncoder().encode('test'),`evt-1.${timestamp}.${raw}`)).toString('base64')}`});
  assert.equal((await worker.fetch(await signed(1),env)).status,401);
  assert.equal((await worker.fetch(await signed(Math.floor(Date.now()/1000)),env)).status,200);
  assert.equal(sql.prepare('SELECT status FROM contacts').get().status,'suppressed');
});
