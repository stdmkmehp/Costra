import fs from 'fs';
import zlib from 'zlib';
const buf = fs.readFileSync(process.argv[2]);
let p = 8, idat = [], W, H, ct;
while (p < buf.length) { const len = buf.readUInt32BE(p); p += 4; const t = buf.toString('ascii', p, p + 4); p += 4; const d = buf.slice(p, p + len); p += len; p += 4; if (t === 'IHDR') { W = d.readUInt32BE(0); H = d.readUInt32BE(4); ct = d[9]; } else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break; }
const raw = zlib.inflateSync(Buffer.concat(idat));
const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1, stride = W * ch, out = Buffer.alloc(H * stride);
const pae = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
let rp = 0;
for (let y = 0; y < H; y++) { const f = raw[rp++]; for (let x = 0; x < stride; x++) { const cur = raw[rp++]; const a = x >= ch ? out[y * stride + x - ch] : 0, b = y > 0 ? out[(y - 1) * stride + x] : 0, c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0; let v; switch (f) { case 1: v = cur + a; break; case 2: v = cur + b; break; case 3: v = cur + ((a + b) >> 1); break; case 4: v = cur + pae(a, b, c); break; default: v = cur; } out[y * stride + x] = v & 255; } }
console.log('W', W, 'H', H);
let ruler = '    ';
for (let x = 0; x < W; x++) ruler += x % 10 === 0 ? String((x / 10) % 10) : ' ';
console.log(ruler);
for (let y = 0; y < H; y++) { let row = ''; for (let x = 0; x < W; x++) { const i = y * stride + x * ch; const r = out[i], g = out[i + 1] ?? r, bl = out[i + 2] ?? r, al = ch === 4 ? out[i + 3] : 255; row += (al > 100 && (r + g + bl) / 3 < 140) ? '#' : '.'; } console.log(String(y).padStart(3) + ' ' + row); }
