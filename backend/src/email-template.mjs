import { marked } from 'marked';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function url(value,image=false){try{const u=new URL(value);return (image ? ['https:'] : ['https:','http:','mailto:']).includes(u.protocol)?escapeHTML(u.href):null;}catch{return null;}}
function inline(tokens=[]){return tokens.map(t=>{
  const content=()=>inline(t.tokens||[{type:'text',text:t.text||''}]);
  switch(t.type){
    case 'strong':return `<strong>${content()}</strong>`;
    case 'em':return `<em>${content()}</em>`;
    case 'del':return `<del>${content()}</del>`;
    case 'codespan':return `<code style="font-family:Consolas,monospace;background:#f1f2f6;padding:2px 4px;border-radius:4px">${escapeHTML(t.text)}</code>`;
    case 'br':return '<br>';
    case 'link':{const href=url(t.href);return href?`<a href="${href}" style="color:#6d49d9;text-decoration:underline">${content()}</a>`:content();}
    case 'image':{const src=url(t.href,true);return src?`<img src="${src}" alt="${escapeHTML(t.text)}" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;margin:16px 0">`:escapeHTML(t.text);}
    case 'escape':return escapeHTML(t.text);
    case 'html':return escapeHTML(t.text);
    default:return t.tokens?content():escapeHTML(t.text||t.raw||'');
  }
}).join('');}
function blocks(tokens=[]){return tokens.map(t=>{
 switch(t.type){
 case 'space':return '';
 case 'heading':return `<h${t.depth} style="font-family:Arial,Helvetica,sans-serif;font-size:${[0,28,23,19,17,16,16][t.depth]}px;line-height:1.3;color:#171a25;margin:24px 0 12px;font-weight:700">${inline(t.tokens)}</h${t.depth}>`;
 case 'paragraph':return `<p style="margin:0 0 18px;line-height:1.7">${inline(t.tokens)}</p>`;
 case 'text':return t.tokens?inline(t.tokens):escapeHTML(t.text);
 case 'list':{const tag=t.ordered?'ol':'ul';return `<${tag} style="padding-left:24px;margin:0 0 20px"${t.ordered?` start="${Number(t.start)||1}"`:''}>${t.items.map(i=>`<li style="padding:3px 0;line-height:1.7">${i.task?(i.checked?'☑ ':'☐ '):''}${blocks(i.tokens)}</li>`).join('')}</${tag}>`;}
 case 'blockquote':return `<blockquote style="margin:20px 0;border-left:3px solid #b8a3ed;padding:0 0 0 18px;color:#626878">${blocks(t.tokens)}</blockquote>`;
 case 'code':return `<pre style="white-space:pre-wrap;word-break:break-word;background:#f3f4f8;padding:16px;font:13px/1.6 Consolas,monospace">${escapeHTML(t.text)}</pre>`;
 case 'hr':return '<hr style="border:0;border-top:1px solid #e8e9ee;margin:28px 0">';
 case 'table':return `<table role="table" cellpadding="8" cellspacing="0" width="100%" style="border-collapse:collapse;margin:20px 0;font-size:14px"><thead><tr>${t.header.map(c=>`<th style="text-align:left;border-bottom:2px solid #dfe1e8">${inline(c.tokens)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(c=>`<td style="border-bottom:1px solid #e8e9ee">${inline(c.tokens)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 case 'html':return `<p>${escapeHTML(t.text)}</p>`;
 default:return escapeHTML(t.raw||'');
 }
}).join('');}
export function renderEmail({subject='',markdown='',preheader='',postalAddress='',unsubscribeUrl='#',test=false}){
 const body=blocks(marked.lexer(markdown,{gfm:true,breaks:false}));
 const footer=postalAddress?escapeHTML(postalAddress).replace(/\n/g,'<br>'):'Mailing address will appear here';
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHTML(subject)}</title></head><body style="margin:0;padding:0;background:#f4f5f8;color:#343847;font:16px/1.7 Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHTML(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8"><tr><td align="center" style="padding:32px 12px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #e8e9ef;border-radius:12px"><tr><td style="padding:28px 32px 8px;font:bold 21px Arial,Helvetica,sans-serif;color:#1b1e2b">TabTab<span style="color:#8562d9">.</span></td></tr><tr><td style="padding:12px 32px 24px;font:16px/1.7 Arial,Helvetica,sans-serif">${test?'<p style="font-size:12px;color:#75618f">TEST EMAIL · Only sent to your test inbox</p>':''}${body}</td></tr><tr><td style="padding:22px 32px;border-top:1px solid #eee;font:12px/1.7 Arial,Helvetica,sans-serif;color:#818594">TabTab release updates<br>${footer}<br><a href="${url(unsubscribeUrl)||'#'}" style="color:#727887;text-decoration:underline">Unsubscribe</a> · <a href="https://tabtabapp.net" style="color:#727887;text-decoration:underline">tabtabapp.net</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
 return {html,text:`${test?'TEST EMAIL\n\n':''}${markdown}\n\nTabTab\n${postalAddress||'Mailing address will appear here'}\nUnsubscribe: ${unsubscribeUrl}`};
}
