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
} else {
  console.log('Usage: node backend/scripts/contacts.mjs import FILE.json [--apply] | export NEW_FILE.json');
}
