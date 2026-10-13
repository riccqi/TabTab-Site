const encoder = new TextEncoder();
const bytes = value => encoder.encode(value);
export const hex = buffer => [...new Uint8Array(buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
export async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256', bytes(value))); }
async function key(secret) {
  return crypto.subtle.importKey('raw', typeof secret === 'string' ? bytes(secret) : secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function hmac(secret, value) { return new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret), bytes(value))); }
export async function verifyHmac(secret, value, signature) {
  return crypto.subtle.verify('HMAC', await key(secret), signature, bytes(value));
}
const b64 = data => btoa(String.fromCharCode(...data));
const unb64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const url64 = data => b64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrl64 = value => unb64(value.replace(/-/g, '+').replace(/_/g, '/'));
export async function token(secret, payload) {
  const body = url64(bytes(JSON.stringify(payload)));
  return `${body}.${url64(await hmac(secret, body))}`;
}
export async function verifyToken(secret, value, purpose) {
  try {
    if (!secret || typeof value !== 'string' || value.length > 2048) return null;
    const parts = value.split('.');
    if (parts.length !== 2 || !await verifyHmac(secret, parts[0], fromUrl64(parts[1]))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromUrl64(parts[0])));
    if (data.purpose !== purpose || typeof data.id !== 'string' || (data.exp && data.exp < Date.now())) return null;
    return data;
  } catch { return null; }
}
export async function verifyLemon(secret, body, signature) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature || '')) return false;
  return verifyHmac(secret, body, Uint8Array.from(signature.match(/../g), x => parseInt(x, 16)));
}
export async function verifyResend(secret, body, headers) {
  try {
    const id = headers.get('svix-id');
    const timestamp = headers.get('svix-timestamp');
    if (!secret || !id || !/^\d+$/.test(timestamp || '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    const signingKey = unb64(secret.replace(/^whsec_/, ''));
    for (const signature of (headers.get('svix-signature') || '').split(' ')) {
      const [version, value] = signature.split(',');
      if (version === 'v1' && value && await verifyHmac(signingKey, `${id}.${timestamp}.${body}`, unb64(value))) return true;
    }
    return false;
  } catch { return false; }
}
