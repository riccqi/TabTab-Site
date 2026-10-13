import { readFile, writeFile } from 'node:fs/promises';
import { cleanContact } from '../src/store.mjs';

const [command, file] = process.argv.slice(2);
const base = process.env.TABTAB_EMAIL_URL || 'https://updates.tabtabapp.net';
const secret = process.env.TABTAB_ADMIN_TOKEN;
async function api(path, body) {
  if (!secret) throw new Error('Set TABTAB_ADMIN_TOKEN in your environment. Do not pass secrets on the command line.');
  const response = await fetch(`${base}${path}`, { method:body ? 'POST':'GET', headers:{ Authorization:`Bearer ${secret}`, 'Content-Type':'application/json' }, ...(body ? {body:JSON.stringify(body)}:{}), signal:AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
export async function allContacts() {
  let rows=[],next='';
  do { const page=await api(`/admin/contacts?after=${encodeURIComponent(next)}`); rows.push(...page.contacts); next=page.next; } while(next);
  return rows;
}
if (command === 'import') {
  const rows=JSON.parse(await readFile(file,'utf8'));
  if (!Array.isArray(rows)) throw new Error('Expected a JSON array.');
  rows.forEach(cleanContact);
  const counts=Object.fromEntries(['customer','subscribed','unsubscribed','suppressed'].map(s=>[s,rows.filter(r=>r.status===s).length]));
  console.log({ records:rows.length,uniqueEmails:new Set(rows.map(r=>r.email.trim().toLowerCase())).size,status:counts });
  if (!process.argv.includes('--apply')) console.log('Dry run. Add --apply to import.');
  else for(let i=0;i<rows.length;i+=25) { await api('/admin/import',rows.slice(i,i+25)); console.log(`Imported ${Math.min(i+25,rows.length)}/${rows.length}`); }
} else if (command === 'export') {
  const rows=await allContacts();
  await writeFile(file,JSON.stringify(rows,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(`Exported ${rows.length} contacts.`);
} else if (command === 'release') {
  const release=JSON.parse(await readFile(file,'utf8'));
  if (!release.campaign_id || !release.subject || !release.text) throw new Error('Need campaign_id, subject and text.');
  const rows=(await allContacts()).filter(r=>r.status==='subscribed');
  const limit=Number(process.env.TABTAB_SEND_LIMIT || '80');
  if (!Number.isInteger(limit) || limit<1) throw new Error('Invalid TABTAB_SEND_LIMIT.');
  console.log({campaign:release.campaign_id,subject:release.subject,eligible:rows.length,maximumNewSends:limit});
  if (!process.argv.includes('--send')) console.log('Dry run. Review the release, then add --send. Free plan: keep total API sends, including confirmations, under 100/day.');
  else {
    let sent=0;
    for(const row of rows) {
      const result=await api('/admin/send',{...release,contact_id:row.id});
      if(result.sent) sent++;
      if(sent>=limit) break;
      await new Promise(resolve=>setTimeout(resolve,600));
    }
    console.log({sent});
  }
} else {
  console.log('Usage: node backend/scripts/contacts.mjs import FILE.json [--apply] | export NEW_FILE.json | release RELEASE.json [--send]');
}
