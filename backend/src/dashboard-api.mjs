import {sha256} from './crypto.mjs';
import {renderEmail} from './email-template.mjs';
import {sentLastDay} from '@riccqi/email-studio/outbox';
export async function settings(env){return await env.DB.prepare('SELECT postal_address FROM dashboard_settings WHERE id=1').first()||{postal_address:env.POSTAL_ADDRESS||''};}
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
  const [config,counts,usage,campaigns]=await Promise.all([settings(env),env.DB.prepare('SELECT status,COUNT(*) total FROM contacts GROUP BY status').all(),sentLastDay(env),env.DB.prepare(`SELECT c.*,COUNT(d.id) total,SUM(CASE WHEN d.status='sent' THEN 1 ELSE 0 END) sent,SUM(CASE WHEN d.status IN ('queued','retry','sending') THEN 1 ELSE 0 END) remaining,SUM(CASE WHEN d.status='skipped' THEN 1 ELSE 0 END) skipped,SUM(CASE WHEN d.status IN ('failed','ambiguous') THEN 1 ELSE 0 END) errors FROM campaigns c LEFT JOIN deliveries d ON d.campaign_id=c.id AND d.kind='announcement' WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY c.created_at DESC LIMIT 50`).all()]);
  // Completion is derived from the outbox; the stored state only records draft/sending/paused.
  for(const c of campaigns.results)if(c.state==='sending'&&!c.remaining)c.state=c.errors?'needs_review':'completed';
  return json({email:env.DASHBOARD_EMAIL,settings:config,counts:counts.results,usage,campaigns:campaigns.results});
 }
 if(path==='/drafts/deleted'&&req.method==='GET')return json({drafts:(await env.DB.prepare("SELECT id,subject,created_at,updated_at,deleted_at FROM campaigns WHERE state='draft' AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100").all()).results});
 const trashAction=path.match(/^\/campaign\/([a-zA-Z0-9-]{1,80})\/(delete|restore)$/);
 if(trashAction&&req.method==='POST'){
  const [,id,verb]=trashAction,remove=verb==='delete',stamp=now();
  const row=await env.DB.prepare(`UPDATE campaigns SET deleted_at=?,updated_at=? WHERE id=? AND state='draft' AND deleted_at IS ${remove?'NULL':'NOT NULL'} AND NOT EXISTS(SELECT 1 FROM deliveries WHERE campaign_id=campaigns.id) RETURNING id`).bind(remove?stamp:null,stamp,id).first();
  if(!row){const existing=await env.DB.prepare('SELECT state,deleted_at FROM campaigns WHERE id=?').bind(id).first();if(!existing)bad('Draft not found.',404);if(existing.state!=='draft'||await env.DB.prepare('SELECT id FROM deliveries WHERE campaign_id=? LIMIT 1').bind(id).first())bad('Only unsent drafts can be deleted or restored.',409);if(remove?existing.deleted_at===null:existing.deleted_at!==null)bad('Draft changed. Reload and try again.',409);}
  return json({ok:true,deleted:remove});
 }
 if(path==='/contacts'&&req.method==='GET'){
  const search=(u.searchParams.get('q')||'').slice(0,120).replace(/[\\%_]/g,x=>'\\'+x),status=u.searchParams.get('status')||'',page=Math.max(0,Math.min(100000,Number(u.searchParams.get('page'))||0));
  const where="WHERE (?='' OR c.status=?) AND (c.email LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')",args=[status,status,`%${search}%`,`%${search}%`];
  const total=await env.DB.prepare(`SELECT COUNT(*) total FROM contacts c ${where}`).bind(...args).first();
  const rows=await env.DB.prepare(`SELECT c.id,c.email,c.name,c.status,c.consent_at,c.consent_source,c.subscription_basis,c.created_at,c.created_at added_at,c.unsubscribed_at,(SELECT source FROM contact_sources WHERE contact_id=c.id ORDER BY recorded_at,rowid LIMIT 1) added_via,(SELECT GROUP_CONCAT(DISTINCT source) FROM contact_sources WHERE contact_id=c.id) sources FROM contacts c ${where} ORDER BY c.created_at DESC,c.id LIMIT 50 OFFSET ?`).bind(...args,page*50).all();return json({contacts:rows.results,total:total.total,page});
 }
 if(path==='/unsubscribe'&&req.method==='POST'){
  const d=await input(req);if(typeof d?.id!=='string')bad('Invalid contact.');await env.DB.prepare("UPDATE contacts SET status=CASE WHEN status='suppressed' THEN status ELSE 'unsubscribed' END,confirmation_nonce=NULL,unsubscribed_at=?,updated_at=? WHERE id=?").bind(now(),now(),d.id).run();return json({ok:true});
 }
 if(path==='/settings'&&req.method==='POST'){
  const d=await input(req);if(typeof d?.postal_address!=='string'||d.postal_address.length>500)bad('Invalid settings.');
  await env.DB.prepare('UPDATE dashboard_settings SET postal_address=? WHERE id=1').bind(d.postal_address.trim()).run();return json({ok:true});
 }
 if(path==='/preview'&&req.method==='POST'){
  const d=safeDraft(await input(req)),config=await settings(env);const saved=typeof d.id==='string'?await env.DB.prepare('SELECT state,postal_address FROM campaigns WHERE id=?').bind(d.id).first():null;return json(renderEmail({...d,postalAddress:saved&&saved.state!=='draft'?saved.postal_address:config.postal_address,unsubscribeUrl:`${env.PUBLIC_URL}/unsubscribe`}));
 }
 if(path==='/campaign'&&req.method==='POST'){
  const d=safeDraft(await input(req)),id=d.id||crypto.randomUUID();if(!/^[a-zA-Z0-9-]{1,80}$/.test(id))bad('Invalid draft ID.');
  const row=await env.DB.prepare(`INSERT INTO campaigns(id,subject,markdown,preheader,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject=excluded.subject,markdown=excluded.markdown,preheader=excluded.preheader,updated_at=excluded.updated_at,test_hash=CASE WHEN campaigns.subject=excluded.subject AND campaigns.markdown=excluded.markdown AND campaigns.preheader=excluded.preheader THEN campaigns.test_hash ELSE NULL END WHERE campaigns.state='draft' AND campaigns.deleted_at IS NULL RETURNING id`).bind(id,d.subject,d.markdown,d.preheader,now(),now()).first();
  if(!row)bad('A campaign that has started cannot be edited. Create a new draft.',409);return json({id});
 }
 const action=path.match(/^\/campaign\/([a-zA-Z0-9-]+)\/(test|start|pause|resume)$/);
 if(action&&req.method==='POST'){
  const [,id,verb]=action,c=await env.DB.prepare('SELECT * FROM campaigns WHERE id=? AND deleted_at IS NULL').bind(id).first();if(!c)bad('Campaign not found.',404);
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
   env.DB.prepare("INSERT OR IGNORE INTO deliveries(id,campaign_id,contact_id,kind,available_at) SELECT lower(hex(randomblob(16))),?,id,'announcement',? FROM contacts WHERE status='subscribed' AND EXISTS (SELECT 1 FROM campaigns WHERE id=? AND state='draft' AND deleted_at IS NULL AND subject=? AND markdown=? AND preheader=? AND test_hash=?)").bind(id,Math.floor(Date.now()/1000),id,c.subject,c.markdown,c.preheader,c.test_hash),
   env.DB.prepare("UPDATE campaigns SET state='sending',postal_address=?,started_at=?,updated_at=? WHERE id=? AND state='draft' AND deleted_at IS NULL AND subject=? AND markdown=? AND preheader=? AND test_hash=?").bind(config.postal_address,now(),now(),id,c.subject,c.markdown,c.preheader,c.test_hash)
  ]);
  const started=await env.DB.prepare('SELECT state,subject,markdown,preheader FROM campaigns WHERE id=?').bind(id).first();
  if(!started||started.state==='draft'||started.subject!==c.subject||started.markdown!==c.markdown||started.preheader!==c.preheader)bad('Draft changed. Reload, send a new test, and review it again.',409);
  return json({ok:true});
 }
 bad('Not found.',404);
}
