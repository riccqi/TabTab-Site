export async function settings(env){return await env.DB.prepare('SELECT postal_address,daily_limit FROM dashboard_settings WHERE id=1').first()||{postal_address:env.POSTAL_ADDRESS||'',daily_limit:0};}
const today=()=>new Date().toISOString().slice(0,10);
// 0 means no daily cap (Resend Pro); attempts are still counted for the dashboard.
function dailyLimit(config,release){return config.daily_limit===0?Number.MAX_SAFE_INTEGER:Math.max(0,config.daily_limit-(release&&config.daily_limit===100?20:0));}
export async function reserveEmail(env,release=false,count=1){
 const config=env.EMAIL_SETTINGS||await settings(env),limit=dailyLimit(config,release);
 const row=count<=limit&&await env.DB.prepare(`INSERT INTO email_usage(day,attempts) VALUES (?,?) ON CONFLICT(day) DO UPDATE SET attempts=attempts+? WHERE attempts+?<=? RETURNING attempts`).bind(today(),count,count,count,limit).first();
 if(!row)throw Object.assign(new Error('Daily sending limit reached. Sending resumes after midnight UTC.'),{status:429,quota:true});
}
export async function refundEmail(env,count){await env.DB.prepare('UPDATE email_usage SET attempts=MAX(0,attempts-?) WHERE day=?').bind(count,today()).run();}
// How many campaign emails the next batch may contain (at most `max`).
export async function remainingEmails(env,max){
 const config=env.EMAIL_SETTINGS||await settings(env);if(config.daily_limit===0)return max;
 const used=(await env.DB.prepare('SELECT attempts FROM email_usage WHERE day=?').bind(today()).first())?.attempts||0;
 return Math.max(0,Math.min(max,dailyLimit(config,true)-used));
}
