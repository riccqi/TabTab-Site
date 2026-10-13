export async function settings(env){return await env.DB.prepare('SELECT postal_address,daily_limit FROM dashboard_settings WHERE id=1').first()||{postal_address:env.POSTAL_ADDRESS||'',daily_limit:100};}
export async function reserveEmail(env,release=false){
 const config=env.EMAIL_SETTINGS||await settings(env),day=new Date().toISOString().slice(0,10);
 const limit=Math.max(0,config.daily_limit-(release&&config.daily_limit===100?20:0));
 const row=await env.DB.prepare(`INSERT INTO email_usage(day,attempts) VALUES (?,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1 WHERE attempts<? RETURNING attempts`).bind(day,limit).first();
 if(!row)throw Object.assign(new Error('Daily sending limit reached. Sending resumes after midnight UTC.'),{status:429,quota:true});
}
