/**
 * 內網 CIDR 檢查（IPv4；::1 / ::ffff: 會正規化）
 */
function normalizeIp(ip) {
  let s = String(ip || '').trim();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (s === '::1') return '127.0.0.1';
  return s;
}

function isLoopback(ip) {
  const s = normalizeIp(ip);
  return s === '127.0.0.1' || s === 'localhost' || s === '::1';
}

function ipv4ToInt(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function ipInCidr(ip, cidr) {
  const s = normalizeIp(ip);
  const spec = String(cidr || '').trim();
  if (!spec) return false;
  if (spec === s || spec.toLowerCase() === 'localhost') return s === spec || (spec === 'localhost' && s === '127.0.0.1');
  if (!spec.includes('/')) return spec === s;
  const [base, bitsStr] = spec.split('/');
  const bits = Number(bitsStr);
  const ipn = ipv4ToInt(s);
  const basen = ipv4ToInt(base);
  if (ipn == null || basen == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipn & mask) === (basen & mask);
}

function parseCidrList(text) {
  return String(text || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ipAllowed(ip, cidrs) {
  if (isLoopback(ip)) return true;
  const list = Array.isArray(cidrs) ? cidrs : parseCidrList(cidrs);
  return list.some((c) => ipInCidr(ip, c));
}

module.exports = {
  normalizeIp,
  isLoopback,
  ipInCidr,
  parseCidrList,
  ipAllowed,
};
