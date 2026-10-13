import {sha256} from './crypto.mjs';
import {renderEmail} from './email-template.mjs';
import {settings} from './mail-budget.mjs';
const json=(x,status=200,headers={})=>Response.json(x,{status,headers});
const bad=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const now=()=>new Date().toISOString();
async function input(req){if(Number(req.headers.get('content-length'))>40000)bad('Message is too large.',413);const reader=req.body?.getReader();let text='',size=0;const decoder=new TextDecoder();if(reader)while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>40000){await reader.cancel();bad('Message is too large.',413);}text+=decoder.decode(p.value,{stream:true});}text+=decoder.decode();try{return JSON.parse(text);}catch{bad('Invalid request.');}}
function safeDraft(d){if(!d||typeof d.subject!=='string'||d.subject.length>200||typeof d.markdown!=='string'||d.markdown.length>20000||typeof d.preheader!=='string'||d.preheader.length>200)bad('Use a subject up to 200 characters and a message up to 20,000 characters.');return d;}
async function session(req,env){
 const bearer=req.headers.get('authorization');if(bearer&&env.SHARED_STUDIO_TOKEN&&await sha256(bearer)===await sha256(`Bearer ${env.SHARED_STUDIO_TOKEN}`))return 'shared-studio';if(bearer&&env.ADMIN_TOKEN&&await sha256(bearer)===await sha256(`Bearer ${env.ADMIN_TOKEN}`))return 'operator';
 const value=(req.headers.get('cookie')||'').match(/(?:^|;\s*)__Host-tabtab_session=([^;]+)/)?.[1];
 if(!value||value.length>128)return null;
 const digest=await sha256(value),row=await env.DB.prepare('SELECT digest FROM dashboard_sessions WHERE digest=? AND expires_at>?').bind(digest,Date.now()).first();return row?.digest||null;
}
const cookie=value=>`__Host-tabtab_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${value?604800:0}`;
export async function dashboardAPI(req,env,services){
 const u=new URL(req.url),path=u.pathname.replace('/dashboard/api','');
 if(req.method!=='GET'&&(req.headers.get('origin')!==u.origin||req.headers.get('x-tabtab-dashboard')!=='1'))bad('Please reload the dashboard and try again.',403);
 if(env.STUDIO_URL){if(await session(req,env)!=='shared-studio')bad('Sign in through the shared email studio.',401);if(['/login','/verify','/logout'].includes(path))bad('Use the shared studio sign-in.',404);}
 if(path==='/login'&&req.method==='POST'){
  if(!env.DASHBOARD_EMAIL)bad('Dashboard sign-in is not configured.',503);
  if(!(await env.SIGNUP_LIMITER.limit({key:`dashboard/${req.headers.get('CF-Connecting-IP')||'local'}`})).success)bad('Please wait a minute before trying again.',429);
  const recent=await env.DB.prepare('SELECT COUNT(*) n FROM dashboard_codes WHERE created_at>?').bind(Date.now()-3600000).first();
  if(recent.n>=6)bad('Too many sign-in emails requested. Try again later.',429);
  const id=crypto.randomUUID(),a=new Uint32Array(1);crypto.getRandomValues(a);const code=String(a[0]%100000000).padStart(8,'0');
  await env.DB.prepare('INSERT INTO dashboard_codes(id,digest,expires_at,created_at) VALUES (?,?,?,?)').bind(id,await sha256(`${id}/${code}/${env.TOKEN_SECRET}`),Date.now()+600000,Date.now()).run();
  await services.sendEmail(env,{to:env.DASHBOARD_EMAIL,subject:'Your TabTab dashboard sign-in code',text:`Your TabTab sign-in code is ${code}. It expires in 10 minutes. If you did not request it, ignore this email.`},`dashboard-login/${id}`);
  return json({id,message:'A sign-in code was sent to your owner email.'});
 }
 if(path==='/verify'&&req.method==='POST'){
  const d=await input(req);if(!d||typeof d.id!=='string'||!/^\d{8}$/.test(d.code||''))bad('Enter the 8-digit code.');
  const row=await env.DB.prepare('UPDATE dashboard_codes SET attempts=attempts+1 WHERE id=? AND attempts<5 AND used=0 AND expires_at>? RETURNING digest').bind(d.id,Date.now()).first();
  if(!row||row.digest!==await sha256(`${d.id}/${d.code}/${env.TOKEN_SECRET}`))bad('Code is invalid or expired. Request a new one.',401);
  const used=await env.DB.prepare('UPDATE dashboard_codes SET used=1 WHERE id=? AND used=0 RETURNING id').bind(d.id).first();if(!used)bad('This code has already been used.',401);
  const value=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('INSERT INTO dashboard_sessions(digest,expires_at) VALUES (?,?)').bind(await sha256(value),Date.now()+604800000).run();
  return json({ok:true},200,{'Set-Cookie':cookie(value)});
 }
 const identity=await session(req,env);if(!identity)bad('Sign in to your TabTab dashboard.',401);
 if(path==='/logout'&&req.method==='POST'){await env.DB.prepare('DELETE FROM dashboard_sessions WHERE digest=?').bind(identity).run();return json({ok:true},200,{'Set-Cookie':cookie('')});}
 if(path==='/overview'&&req.method==='GET'){
  const [config,counts,usage,campaigns]=await Promise.all([settings(env),env.DB.prepare('SELECT status,COUNT(*) total FROM contacts GROUP BY status').all(),env.DB.prepare('SELECT attempts FROM email_usage WHERE day=?').bind(now().slice(0,10)).first(),env.DB.prepare(`SELECT c.*,COUNT(r.contact_id) total,SUM(CASE WHEN r.state='sent' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN r.state='queued' OR r.state='processing' THEN 1 ELSE 0 END) remaining,SUM(CASE WHEN r.state='skipped' THEN 1 ELSE 0 END) skipped,SUM(CASE WHEN r.state IN ('failed','uncertain') THEN 1 ELSE 0 END) errors FROM campaigns c LEFT JOIN campaign_recipients r ON r.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`).all()]);
  return json({email:env.DASHBOARD_EMAIL,settings:config,counts:counts.results,usage:usage?.attempts||0,campaigns:campaigns.results});
 }
 if(path==='/contacts'&&req.method==='GET'){
  const search=(u.searchParams.get('q')||'').slice(0,120).replace(/[\\%_]/g,x=>'\\'+x),status=u.searchParams.get('status')||'',page=Math.max(0,Math.min(100000,Number(u.searchParams.get('page'))||0));
  const where="WHERE (?='' OR c.status=?) AND (c.email LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')",args=[status,status,`%${search}%`,`%${search}%`];
  const total=await env.DB.prepare(`SELECT COUNT(*) total FROM contacts c ${where}`).bind(...args).first();
  const rows=await env.DB.prepare(`SELECT c.id,c.email,c.name,c.status,c.consent_at,c.consent_source,c.subscription_basis,c.created_at,(SELECT GROUP_CONCAT(DISTINCT source) FROM contact_sources WHERE contact_id=c.id) sources FROM contacts c ${where} ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET ?`).bind(...args,page*50).all();return json({contacts:rows.results,total:total.total,page});
 }
 if(path==='/unsubscribe'&&req.method==='POST'){
  const d=await input(req);if(typeof d?.id!=='string')bad('Invalid contact.');await env.DB.prepare("UPDATE contacts SET status=CASE WHEN status='suppressed' THEN status ELSE 'unsubscribed' END,confirmation_nonce=NULL,unsubscribed_at=?,updated_at=? WHERE id=?").bind(now(),now(),d.id).run();return json({ok:true});
 }
 if(path==='/settings'&&req.method==='POST'){
  const d=await input(req);if(typeof d?.postal_address!=='string'||d.postal_address.length>500||![100,5000].includes(d.daily_limit))bad('Invalid settings.');
  if(d.daily_limit>100&&d.paid_plan_confirmed!==true)bad('Confirm that your Resend account has a paid sending plan first.');
  await env.DB.prepare('UPDATE dashboard_settings SET postal_address=?,daily_limit=? WHERE id=1').bind(d.postal_address.trim(),d.daily_limit).run();return json({ok:true});
 }
 if(path==='/preview'&&req.method==='POST'){
  const d=safeDraft(await input(req)),config=await settings(env);const saved=typeof d.id==='string'?await env.DB.prepare('SELECT state,postal_address FROM campaigns WHERE id=?').bind(d.id).first():null;return json(renderEmail({...d,postalAddress:saved&&saved.state!=='draft'?saved.postal_address:config.postal_address,unsubscribeUrl:`${env.PUBLIC_URL}/unsubscribe`}));
 }
 if(path==='/campaign'&&req.method==='POST'){
  const d=safeDraft(await input(req)),id=d.id||crypto.randomUUID();if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))bad('Invalid draft ID.');
  const row=await env.DB.prepare(`INSERT INTO campaigns(id,subject,markdown,preheader,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,markdown=excluded.markdown,preheader=excluded.preheader,updated_at=excluded.updated_at,test_hash=CASE WHEN campaigns.subject=excluded.subject AND campaigns.markdown=excluded.markdown AND campaigns.preheader=excluded.preheader THEN campaigns.test_hash ELSE NULL END WHERE campaigns.state='draft' RETURNING id`).bind(id,d.subject,d.markdown,d.preheader,now(),now()).first();
  if(!row)bad('A campaign that has started cannot be edited. Create a new draft.',409);return json({id});
 }
 const action=path.match(/^\/campaign\/([a-zA-Z0-9-]+)\/(test|start|pause|resume)$/);
 if(action&&req.method==='POST'){
  const [,id,verb]=action,c=await env.DB.prepare('SELECT * FROM campaigns WHERE id=?').bind(id).first();if(!c)bad('Campaign not found.',404);
  const config=await settings(env);
  if(verb==='test'){
   const d=await input(req),email=services.normalizeEmail(d?.email||env.DASHBOARD_EMAIL);if(!email)bad('Enter a valid test address.');if(!c.subject.trim()||!c.markdown.trim())bad('Add a subject and message first.');
   const rendered=renderEmail({...c,postalAddress:config.postal_address,unsubscribeUrl:`${env.PUBLIC_URL}/dashboard/test-unsubscribe`,test:false});
   await services.sendEmail(env,{to:email,subject:`[TEST] ${c.subject}`,...rendered},`dashboard-test/${crypto.randomUUID()}`);
   await env.DB.prepare('UPDATE campaigns SET test_hash=? WHERE id=? AND subject=? AND markdown=? AND preheader=?').bind(await sha256(JSON.stringify([c.subject,c.markdown,c.preheader,config.postal_address])),id,c.subject,c.markdown,c.preheader).run();return json({ok:true});
  }
  if(verb==='pause'){await env.DB.prepare("UPDATE campaigns SET state='paused',updated_at=? WHERE id=? AND state='sending'").bind(now(),id).run();return json({ok:true});}
  if(verb==='resume'){await env.DB.prepare("UPDATE campaigns SET state='sending',last_error=NULL,updated_at=? WHERE id=? AND state='paused'").bind(now(),id).run();return json({ok:true});}
  const d=await input(req);if(d?.confirmation!==c.subject)bad('Confirm the campaign subject before sending.');
  if(c.state!=='draft')bad('This campaign has already started.',409);
  if(!config.postal_address.trim())bad('Add your mailing address in Settings before sending.');
  if(c.test_hash!==await sha256(JSON.stringify([c.subject,c.markdown,c.preheader,config.postal_address])))bad('Send a test of this exact draft and footer before sending to the list.');
  if(!env.RESEND_WEBHOOK_SECRET)bad('Bounce handling must be configured first.',503);
  // The state transition and audience snapshot are atomic. Double clicks do not rebuild the audience.
  await env.DB.batch([
   env.DB.prepare("INSERT OR IGNORE INTO campaign_recipients(campaign_id,contact_id) SELECT ?,id FROM contacts WHERE status='subscribed' AND EXISTS (SELECT 1 FROM campaigns WHERE id=? AND state='draft' AND subject=? AND markdown=? AND preheader=? AND test_hash=?)").bind(id,id,c.subject,c.markdown,c.preheader,c.test_hash),
   env.DB.prepare("UPDATE campaigns SET state='sending',postal_address=?,started_at=?,updated_at=? WHERE id=? AND state='draft' AND subject=? AND markdown=? AND preheader=? AND test_hash=?").bind(config.postal_address,now(),now(),id,c.subject,c.markdown,c.preheader,c.test_hash)
  ]);
  const started=await env.DB.prepare('SELECT state,subject,markdown,preheader FROM campaigns WHERE id=?').bind(id).first();
  if(!started||started.state==='draft'||started.subject!==c.subject||started.markdown!==c.markdown||started.preheader!==c.preheader)bad('Draft changed. Reload, send a new test, and review it again.',409);
  return json({ok:true});
 }
 bad('Not found.',404);
}
export async function runCampaigns(env,services){
 const campaigns=await env.DB.prepare("SELECT * FROM campaigns WHERE state='sending' ORDER BY started_at LIMIT 1").all();
 if(!campaigns.results.length)return;
 const c=campaigns.results[0];
 env={...env,EMAIL_SETTINGS:await settings(env)};let blocked=false;
 // Recover interrupted runs safely: sendRelease's durable delivery ledger decides whether a retry is safe.
 await env.DB.prepare("UPDATE campaign_recipients SET state='queued' WHERE campaign_id=? AND state='processing' AND claimed_at<?").bind(c.id,Date.now()-600000).run();
 for(let i=0;i<6;i++){
  const r=await env.DB.prepare(`UPDATE campaign_recipients SET state='processing',claimed_at=? WHERE campaign_id=? AND contact_id=(SELECT contact_id FROM campaign_recipients WHERE campaign_id=? AND state='queued' ORDER BY contact_id LIMIT 1) AND state='queued' AND EXISTS(SELECT 1 FROM campaigns WHERE id=? AND state='sending') RETURNING contact_id`).bind(Date.now(),c.id,c.id,c.id).first();
  if(!r)break;
  try{
   const result=await services.sendRelease(new Request('https://internal/admin/send',{method:'POST',body:JSON.stringify({campaign_id:c.id,contact_id:r.contact_id,subject:c.subject,markdown:c.markdown,preheader:c.preheader})}),{...env,POSTAL_ADDRESS:c.postal_address});
   const data=await result.json();await env.DB.prepare('UPDATE campaign_recipients SET state=?,error=NULL WHERE campaign_id=? AND contact_id=?').bind(data.skipped?'skipped':'sent',c.id,r.contact_id).run();
  }catch(e){
   blocked=true;
   if(e.quota){await env.DB.prepare("UPDATE campaign_recipients SET state='queued' WHERE campaign_id=? AND contact_id=?").bind(c.id,r.contact_id).run();await env.DB.prepare('UPDATE campaigns SET last_error=? WHERE id=?').bind(e.message,c.id).run();break;}
   await env.DB.batch([env.DB.prepare("UPDATE campaign_recipients SET state='uncertain',error=? WHERE campaign_id=? AND contact_id=?").bind(e.message,c.id,r.contact_id),env.DB.prepare("UPDATE campaigns SET state='paused',last_error=?,updated_at=? WHERE id=?").bind('Delivery needs review: '+e.message,now(),c.id)]);break;
  }
  if(i<5)await (services.delay || (ms=>new Promise(resolve=>setTimeout(resolve,ms))))(650);
 }
 if(!blocked)await env.DB.prepare('UPDATE campaigns SET last_error=NULL,updated_at=? WHERE id=?').bind(now(),c.id).run();
 await env.DB.prepare("UPDATE campaigns SET state=CASE WHEN EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id=campaigns.id AND state IN ('failed','uncertain')) THEN 'needs_review' ELSE 'completed' END,updated_at=? WHERE id=? AND state='sending' AND NOT EXISTS(SELECT 1 FROM campaign_recipients WHERE campaign_id=? AND state IN ('queued','processing'))").bind(now(),c.id,c.id).run();
}
