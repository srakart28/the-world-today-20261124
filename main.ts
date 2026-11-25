// The World Today — one image that sums up the world news of Tuesday 24 November 2026.
//
// Entry for make.fun's "Sum up 24 November's world news in one image" bounty.
// This program draws the whole front page itself: a software rasteriser renders
// panels, pictograms and text (glyph coverage baked from the Noto fonts, SIL OFL
// 1.1, lives in ./fonts.ts) onto a 2x-supersampled canvas, downsamples it, and
// writes a PNG to /output/entry.png (or $MAKEFUN_OUTPUT_DIR). No network, no
// external assets, no clock or randomness: two runs write identical bytes.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { FONT_BLOB } from './fonts.ts';

// ---------------------------------------------------------------- canvas ----
const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor
const CW = W * SS;
const CH = H * SS;
const px = new Uint8Array(CW * CH * 3);

type RGB = [number, number, number];
const PAPER: RGB = [250, 246, 236];
const CARD: RGB = [255, 254, 248];
const INK: RGB = [23, 25, 31];
const WHITE: RGB = [255, 255, 255];
const RED: RGB = [190, 18, 44];
const MUTED: RGB = [96, 100, 108];
const GREEN: RGB = [118, 185, 0];

function blend(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= CW || y >= CH || a <= 0) return;
  const i = (y * CW + x) * 3;
  if (a >= 1) {
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2];
  } else {
    px[i] = Math.round(px[i] * (1 - a) + c[0] * a);
    px[i + 1] = Math.round(px[i + 1] * (1 - a) + c[1] * a);
    px[i + 2] = Math.round(px[i + 2] * (1 - a) + c[2] * a);
  }
}

function fillAll(c: RGB): void {
  for (let i = 0; i < CW * CH; i++) {
    px[i * 3] = c[0]; px[i * 3 + 1] = c[1]; px[i * 3 + 2] = c[2];
  }
}

// All drawing calls below take design coordinates (1024x1024) and scale by SS.
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.round(x * SS), y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS), y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy++)
    for (let xx = x0; xx < x1; xx++) blend(xx, yy, c, 1);
}

function frame(x: number, y: number, w: number, h: number, t: number, c: RGB): void {
  rect(x, y, w, t, c); rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c); rect(x + w - t, y, t, h, c);
}

function circle(cx: number, cy: number, r: number, c: RGB): void {
  const R = r * SS, CX = cx * SS, CY = cy * SS;
  const x0 = Math.floor(CX - R - 1), x1 = Math.ceil(CX + R + 1);
  const y0 = Math.floor(CY - R - 1), y1 = Math.ceil(CY + R + 1);
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.sqrt((xx - CX) ** 2 + (yy - CY) ** 2);
      blend(xx, yy, c, Math.max(0, Math.min(1, R - d + 0.5)));
    }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  const R = r * SS, T = t * SS, CX = cx * SS, CY = cy * SS;
  const x0 = Math.floor(CX - R - T), x1 = Math.ceil(CX + R + T);
  const y0 = Math.floor(CY - R - T), y1 = Math.ceil(CY + R + T);
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++) {
      const d = Math.sqrt((xx - CX) ** 2 + (yy - CY) ** 2);
      blend(xx, yy, c, Math.max(0, Math.min(1, T / 2 - Math.abs(d - R) + 0.5)));
    }
}

function line(x1: number, y1: number, x2: number, y2: number, t: number, c: RGB): void {
  const ax = x1 * SS, ay = y1 * SS, bx = x2 * SS, by = y2 * SS, T = (t * SS) / 2;
  const minx = Math.floor(Math.min(ax, bx) - T - 1), maxx = Math.ceil(Math.max(ax, bx) + T + 1);
  const miny = Math.floor(Math.min(ay, by) - T - 1), maxy = Math.ceil(Math.max(ay, by) + T + 1);
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
  for (let yy = miny; yy <= maxy; yy++)
    for (let xx = minx; xx <= maxx; xx++) {
      let s = ((xx - ax) * dx + (yy - ay) * dy) / len2;
      s = Math.max(0, Math.min(1, s));
      const d = Math.sqrt((xx - (ax + s * dx)) ** 2 + (yy - (ay + s * dy)) ** 2);
      blend(xx, yy, c, Math.max(0, Math.min(1, T - d + 0.5)));
    }
}

function poly(pts: [number, number][], c: RGB): void {
  const P = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  const ys = P.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(CH - 1, Math.ceil(Math.max(...ys)));
  for (let yy = y0; yy <= y1; yy++) {
    const xs: number[] = [];
    for (let i = 0; i < P.length; i++) {
      const [xa, ya] = P[i], [xb, yb] = P[(i + 1) % P.length];
      if ((ya <= yy && yb > yy) || (yb <= yy && ya > yy)) xs.push(xa + ((yy - ya) / (yb - ya)) * (xb - xa));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let xx = Math.round(xs[k]); xx <= Math.round(xs[k + 1]); xx++) blend(xx, yy, c, 1);
  }
}

function tri(a: [number, number], b: [number, number], c2: [number, number], c: RGB): void {
  poly([a, b, c2], c);
}

// ----------------------------------------------------------------- fonts ----
interface Glyph { adv: number; xoff: number; yoff: number; w: number; h: number; data: Uint8Array }
interface Font { em: number; ascent: number; descent: number; glyphs: Map<number, Glyph> }

function loadFonts(): Font[] {
  const buf = inflateSync(Buffer.from(FONT_BLOB, 'base64'));
  let o = 0;
  const u8 = () => buf[o++];
  const u16 = () => { const v = buf.readUInt16LE(o); o += 2; return v; };
  const i16 = () => { const v = buf.readInt16LE(o); o += 2; return v; };
  const u32 = () => { const v = buf.readUInt32LE(o); o += 4; return v; };
  if (u8() !== 1) throw new Error('bad font blob');
  const count = u8();
  const fonts: Font[] = [];
  for (let f = 0; f < count; f++) {
    const em = u16(), ascent = u16(); u16();
    const n = u16();
    const glyphs = new Map<number, Glyph>();
    for (let g = 0; g < n; g++) {
      const cp = u16(), adv = u16(), xoff = i16(), yoff = i16(), w = u16(), h = u16(), len = u32();
      const data = new Uint8Array(buf.subarray(o, o + len)); o += len;
      glyphs.set(cp, { adv, xoff, yoff, w, h, data });
    }
    fonts.push({ em, ascent, descent: 0, glyphs });
  }
  return fonts;
}
const FONTS = loadFonts();
const SERIF = 0, SANS = 1, BODY = 2;

interface ScaledGlyph { alpha: Uint8Array; w: number; h: number; dx: number; dy: number; adv: number }
const glyphCache = new Map<string, Map<number, ScaledGlyph>>();

function scaledGlyphs(fontIdx: number, sizePx: number): Map<number, ScaledGlyph> {
  const key = fontIdx + ':' + sizePx;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const font = FONTS[fontIdx];
  const scale = sizePx / font.em;
  const out = new Map<number, ScaledGlyph>();
  for (const [cp, g] of font.glyphs) {
    const w = Math.max(1, Math.round(g.w * scale));
    const h = Math.max(1, Math.round(g.h * scale));
    const alpha = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w; xx++) {
        // average the master coverage over the source rect this pixel maps to
        const sx0 = xx / scale, sx1 = (xx + 1) / scale;
        const sy0 = yy / scale, sy1 = (yy + 1) / scale;
        const ix0 = Math.floor(sx0), ix1 = Math.min(g.w - 1, Math.ceil(sx1) - 1);
        const iy0 = Math.floor(sy0), iy1 = Math.min(g.h - 1, Math.ceil(sy1) - 1);
        let sum = 0, cnt = 0;
        for (let sy = iy0; sy <= iy1; sy++)
          for (let sx = ix0; sx <= ix1; sx++) {
            const idx = sy * g.w + sx;
            const nib = (g.data[idx >> 1] >> (idx % 2 === 0 ? 4 : 0)) & 15;
            sum += nib; cnt++;
          }
        alpha[yy * w + xx] = cnt ? Math.round((sum / cnt) * 17) : 0; // back to 0..255
      }
    out.set(cp, {
      alpha, w, h,
      dx: Math.round(g.xoff * scale),
      dy: Math.round((g.yoff - font.ascent) * scale),
      adv: g.adv * scale,
    });
  }
  glyphCache.set(key, out);
  return out;
}

function textWidth(fontIdx: number, size: number, text: string, spacing = 0): number {
  const sizePx = Math.round(size * SS);
  const glyphs = scaledGlyphs(fontIdx, sizePx);
  let w = 0;
  for (const ch of text) {
    const g = glyphs.get(ch.codePointAt(0)!) ?? glyphs.get(63)!;
    w += g.adv + spacing * SS;
  }
  return w / SS;
}

// Draw text with the baseline at (x, yBaseline) in design coords.
// Returns the pen width in design px. align: 'left' | 'center' | 'right'.
function text(
  fontIdx: number, size: number, str: string, x: number, yBaseline: number,
  c: RGB, opts: { spacing?: number; align?: 'left' | 'center' | 'right' } = {},
): number {
  const spacing = opts.spacing ?? 0;
  const width = textWidth(fontIdx, size, str, spacing);
  let penX = x;
  if (opts.align === 'center') penX = x - width / 2;
  if (opts.align === 'right') penX = x - width;
  const sizePx = Math.round(size * SS);
  const glyphs = scaledGlyphs(fontIdx, sizePx);
  const baseY = Math.round(yBaseline * SS);
  let pen = penX * SS;
  for (const ch of str) {
    const g = glyphs.get(ch.codePointAt(0)!) ?? glyphs.get(63)!;
    const gx = Math.round(pen) + g.dx;
    const gy = baseY + g.dy;
    for (let yy = 0; yy < g.h; yy++)
      for (let xx = 0; xx < g.w; xx++) {
        const a = g.alpha[yy * g.w + xx];
        if (a) blend(gx + xx, gy + yy, c, a / 255);
      }
    pen += g.adv + spacing * SS;
  }
  return width;
}

function wrap(fontIdx: number, size: number, str: string, maxWidth: number, spacing = 0): string[] {
  const words = str.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const trial = cur ? cur + ' ' + word : word;
    if (textWidth(fontIdx, size, trial, spacing) <= maxWidth || !cur) cur = trial;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw wrapped text; returns the y of the last baseline.
function block(
  fontIdx: number, size: number, str: string, x: number, yBaseline: number,
  maxWidth: number, lineHeight: number, c: RGB, maxLines = 99,
): number {
  const lines = wrap(fontIdx, size, str, maxWidth).slice(0, maxLines);
  let y = yBaseline;
  for (const ln of lines) { text(fontIdx, size, ln, x, y, c); y += lineHeight; }
  return y - lineHeight;
}

// ------------------------------------------------------------ PNG output ----
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(): Buffer {
  // downsample SSxSS -> final RGB rows
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * CW + (x * SS + sx)) * 3;
          r += px[i]; g += px[i + 1]; b += px[i + 2];
        }
      const o = y * (1 + W * 3) + 1 + x * 3, n = SS * SS;
      raw[o] = Math.round(r / n); raw[o + 1] = Math.round(g / n); raw[o + 2] = Math.round(b / n);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------- pictograms ---
// Each icon draws inside the box (x, y, s) in design px, in fg on the caller's bg.
function waves(x: number, y: number, w: number, rows: number, c: RGB, t = 2.4): void {
  for (let r = 0; r < rows; r++) {
    const yy = y + r * 9;
    for (let xx = 0; xx < w - 8; xx += 8)
      line(x + xx, yy + Math.sin((xx / w) * Math.PI * 2 + r) * 2, x + xx + 8, yy + Math.sin(((xx + 8) / w) * Math.PI * 2 + r) * 2, t, c);
  }
}

function star(cx: number, cy: number, ro: number, ri: number, n: number, c: RGB): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 === 0 ? ro : ri;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  poly(pts, c);
}

function iconShip(x: number, y: number, s: number, fg: RGB, hot: RGB): void {
  const u = s / 76; // unit
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  circle(X(58), Y(16), 8 * u, hot); // sun / flare over the strait
  // tanker: hull, deck containers, bridge
  poly([[X(6), Y(40)], [X(70), Y(40)], [X(63), Y(52)], [X(13), Y(52)]], fg);
  rect(X(14), Y(31), 30 * u, 9 * u, fg);
  rect(X(17), Y(23), 10 * u, 8 * u, fg); rect(X(29), Y(23), 10 * u, 8 * u, fg);
  rect(X(58), Y(20), 7 * u, 20 * u, fg); rect(X(55), Y(16), 10 * u, 4 * u, fg);
  // mine in the water
  circle(X(14), Y(62), 5 * u, hot);
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * i) / 4;
    line(X(14), Y(62), X(14 + Math.cos(a) * 8), Y(62 + Math.sin(a) * 8), 1.8 * u, hot);
  }
  waves(X(24), Y(58), 46, 2, fg, 2.2 * u);
}

function iconDrone(x: number, y: number, s: number, fg: RGB, hot: RGB): void {
  const u = s / 76;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  // quadcopter
  line(X(25), Y(23), X(51), Y(37), 3.4 * u, fg); line(X(51), Y(23), X(25), Y(37), 3.4 * u, fg);
  rect(X(30), Y(24), 16 * u, 12 * u, fg);
  for (const [rx, ry] of [[19, 17], [57, 17], [19, 43], [57, 43]] as const) ring(X(rx), Y(ry), 8 * u, 2.6 * u, fg);
  circle(X(38), Y(30), 2.6 * u, hot);
  // target ship below + burst
  poly([[X(22), Y(62)], [X(62), Y(62)], [X(56), Y(70)], [X(28), Y(70)]], fg);
  rect(X(36), Y(55), 14 * u, 7 * u, fg);
  star(X(66), Y(50), 7.5 * u, 3.2 * u, 6, hot);
  waves(X(6), Y(70), 30, 1, fg, 2 * u);
}

function iconScales(x: number, y: number, s: number, fg: RGB): void {
  const u = s / 76;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  line(X(38), Y(14), X(38), Y(60), 3.4 * u, fg);
  line(X(14), Y(18), X(62), Y(18), 3.4 * u, fg);
  circle(X(38), Y(12), 3.4 * u, fg);
  for (const pxn of [14, 62]) {
    line(X(pxn), Y(18), X(pxn - 8), Y(38), 2 * u, fg);
    line(X(pxn), Y(18), X(pxn + 8), Y(38), 2 * u, fg);
    const pan: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (i / 10);
      pan.push([X(pxn + Math.cos(a) * 10), Y(38 + Math.sin(a) * 5)]);
    }
    poly(pan, fg);
  }
  rect(X(24), Y(60), 28 * u, 4 * u, fg);
  rect(X(30), Y(64), 16 * u, 3.4 * u, fg);
}

function iconGavel(x: number, y: number, s: number, fg: RGB, hot: RGB): void {
  const u = s / 76;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  // smartphone
  rect(X(10), Y(12), 30 * u, 52 * u, fg);
  rect(X(13.5), Y(17), 23 * u, 38 * u, hot);
  circle(X(25), Y(59), 2.4 * u, hot);
  // gavel across the phone
  poly([[X(38), Y(30)], [X(52), Y(16)], [X(62), Y(26)], [X(48), Y(40)]], fg);
  poly([[X(34), Y(34)], [X(44), Y(24)], [X(50), Y(30)], [X(40), Y(40)]], fg);
  line(X(44), Y(36), X(64), Y(56), 5 * u, fg);
  rect(X(46), Y(62), 24 * u, 4 * u, fg); // sound block
}

function iconGlobe(x: number, y: number, s: number, fg: RGB, hot: RGB): void {
  const u = s / 76;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  ring(X(34), Y(38), 24 * u, 3.4 * u, fg);
  line(X(12), Y(38), X(56), Y(38), 1.8 * u, fg);
  // continent blobs
  circle(X(27), Y(29), 5.2 * u, fg); circle(X(38), Y(25), 4.2 * u, fg);
  circle(X(43), Y(41), 5.6 * u, fg); circle(X(29), Y(47), 4.6 * u, fg); circle(X(39), Y(53), 3.4 * u, fg);
  // thermometer
  rect(X(58), Y(14), 5 * u, 34 * u, fg);
  circle(X(60.5), Y(54), 8 * u, fg);
  rect(X(59.5), Y(30), 2.4 * u, 20 * u, hot);
  circle(X(60.5), Y(54), 4.4 * u, hot);
  line(X(52), Y(20), X(56), Y(20), 2 * u, fg); line(X(52), Y(28), X(56), Y(28), 2 * u, fg);
}

function iconSyringe(x: number, y: number, s: number, fg: RGB, hot: RGB): void {
  const u = s / 76;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  // virus behind
  circle(X(56), Y(20), 9 * u, hot);
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * i) / 4 + 0.4;
    line(X(56), Y(20), X(56 + Math.cos(a) * 14), Y(20 + Math.sin(a) * 14), 2 * u, hot);
    circle(X(56 + Math.cos(a) * 15), Y(20 + Math.sin(a) * 15), 2 * u, hot);
  }
  // syringe, diagonal
  poly([[X(16), Y(44)], [X(40), Y(20)], [X(48), Y(28)], [X(24), Y(52)]], fg);
  line(X(44), Y(24), X(58), Y(10), 3 * u, fg); // plunger rod
  rect(X(54), Y(4), 12 * u, 5 * u, fg); // thumb rest (approx, axis-aligned)
  line(X(20), Y(48), X(8), Y(60), 2.6 * u, fg); // needle hub
  line(X(8), Y(60), X(3), Y(68), 1.6 * u, fg); // needle
  for (const t of [0.3, 0.5, 0.7]) {
    const bx = 16 + (40 - 16) * t, by = 44 + (20 - 44) * t;
    line(X(bx), Y(by), X(bx + 6), Y(by + 6), 1.8 * u, hot);
  }
}

function iconTrophy(x: number, y: number, s: number, fg: RGB, hot: RGB): void {
  const u = s / 76;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  ring(X(15), Y(24), 8 * u, 3 * u, fg); ring(X(61), Y(24), 8 * u, 3 * u, fg);
  poly([[X(22), Y(10)], [X(54), Y(10)], [X(50), Y(38)], [X(26), Y(38)]], fg);
  star(X(38), Y(24), 7 * u, 3.2 * u, 5, hot);
  rect(X(34), Y(38), 8 * u, 10 * u, fg);
  rect(X(24), Y(48), 28 * u, 5 * u, fg);
  rect(X(20), Y(53), 36 * u, 5 * u, fg);
  // football
  circle(X(60), Y(58), 9 * u, fg);
  circle(X(60), Y(58), 3.4 * u, hot);
}

function chipArt(x: number, y: number, s: number): void {
  // dark panel drawn by caller; chip + circuit traces + rising arrow in green
  const u = s / 176;
  const X = (v: number) => x + v * u, Y = (v: number) => y + v * u;
  frame(X(48), Y(30), 80 * u, 80 * u, 5 * u, GREEN);
  frame(X(66), Y(48), 44 * u, 44 * u, 4 * u, GREEN);
  for (let i = 0; i < 4; i++) {
    const p = 58 + i * 20;
    rect(X(p), Y(16), 5 * u, 14 * u, GREEN); rect(X(p), Y(110), 5 * u, 14 * u, GREEN);
    rect(X(34), Y(p - 10), 14 * u, 5 * u, GREEN); rect(X(128), Y(p - 10), 14 * u, 5 * u, GREEN);
  }
  // circuit traces with end dots
  line(X(48), Y(130), X(24), Y(130), 3 * u, GREEN); circle(X(20), Y(130), 4 * u, GREEN);
  line(X(128), Y(40), X(152), Y(40), 3 * u, GREEN); circle(X(156), Y(40), 4 * u, GREEN);
  // rising arrow across the top
  line(X(14), Y(158), X(70), Y(128), 6 * u, GREEN);
  line(X(70), Y(128), X(104), Y(146), 6 * u, GREEN);
  line(X(104), Y(146), X(160), Y(102), 6 * u, GREEN);
  tri([X(160), Y(88)], [X(166), Y(116)], [X(140), Y(106)], GREEN);
}

// ------------------------------------------------------------------ page ----
fillAll(PAPER);
const M = 40; // page margin
const RIGHT = W - M;

// masthead block
rect(M, 18, W - 2 * M, 3, INK);
text(SANS, 13.5, "THE DAY'S WORLD NEWS IN ONE IMAGE", M, 46, INK, { spacing: 2.6 });
text(SANS, 13.5, 'GLOBAL EDITION', RIGHT, 46, MUTED, { spacing: 2.6, align: 'right' });
text(SERIF, 86, 'The World Today', W / 2, 128, INK, { align: 'center' });
rect(M, 142, W - 2 * M, 4, INK);
rect(M, 149, W - 2 * M, 1.6, RED);

// date band — the day, named unmissably
rect(M, 160, W - 2 * M, 58, INK);
rect(M, 160, 7, 58, RED); rect(RIGHT - 7, 160, 7, 58, RED);
text(SANS, 38, 'TUESDAY 24 NOVEMBER 2026', W / 2, 202, WHITE, { spacing: 1.5, align: 'center' });
text(BODY, 16.5, 'Eight stories that shaped one day — from Silicon Valley to the Strait of Hormuz', W / 2, 242, MUTED, { align: 'center' });

// lead story
const LY = 254, LH = 208;
rect(M, LY, W - 2 * M, LH, CARD);
frame(M, LY, W - 2 * M, LH, 2, INK);
rect(M + 18, LY + 18, 178, LH - 36, INK);
chipArt(M + 18, LY + 18, LH - 36);
const LX = M + 222;
text(SANS, 15, 'TECHNOLOGY · UNITED STATES', LX, LY + 40, RED, { spacing: 1.6 });
block(SERIF, 45, 'Nvidia reinstates Jensen Huang as CEO', LX, LY + 88, RIGHT - LX - 16, 52, INK, 2);
block(BODY, 19, 'Less than two weeks after resigning, Jensen Huang is back running Nvidia — restored as chief executive after President Trump intervened on his behalf.', LX, LY + 164, RIGHT - LX - 16, 24, INK, 2);

// section label
text(SANS, 15, 'AROUND THE WORLD IN SIX STORIES', M, 496, RED, { spacing: 2 });
text(BODY, 13, 'TUESDAY 24 NOVEMBER 2026', RIGHT, 496, MUTED, { align: 'right' });
rect(M, 504, W - 2 * M, 1.4, INK);

// story cards
interface Story {
  tag: string; accent: RGB; headline: string; summary: string;
  icon: (x: number, y: number, s: number) => void;
}
const SEA: RGB = [15, 110, 140], STEEL: RGB = [47, 93, 138], GOLD: RGB = [138, 109, 31];
const CLIM: RGB = [14, 124, 91], VIOL: RGB = [108, 74, 176];
const stories: Story[] = [
  {
    tag: 'MIDDLE EAST · ENERGY', accent: SEA,
    headline: 'TANKERS HIT MINES IN STRAIT OF HORMUZ',
    summary: 'Iran says four oil tankers struck mines and caught fire; Tehran refuses talks until its terms are met.',
    icon: (x, y, s) => iconShip(x, y, s, WHITE, [255, 150, 60]),
  },
  {
    tag: 'EUROPE · WAR IN UKRAINE', accent: STEEL,
    headline: 'UKRAINE STRIKES RUSSIAN SHIPS OFF LIBYA',
    summary: "Kyiv's drones hit Russian ships in two distant seas; Poland summons Moscow's envoy over missiles.",
    icon: (x, y, s) => iconDrone(x, y, s, WHITE, [242, 176, 30]),
  },
  {
    tag: 'WORLD COURT · ASIA', accent: GOLD,
    headline: 'MYANMAR COMMITTED GENOCIDE, WORLD COURT RULES',
    summary: "The ICJ finds Myanmar's army committed genocide against the Rohingya; 14 nations back the ruling.",
    icon: (x, y, s) => iconScales(x, y, s, WHITE),
  },
  {
    tag: 'US–CHINA · COURTS', accent: RED,
    headline: 'HUAWEI GUILTY OF STEALING TRADE SECRETS',
    summary: 'A US jury convicts Huawei of trade-secret theft and bank fraud, but clears it of racketeering.',
    icon: (x, y, s) => iconGavel(x, y, s, WHITE, RED),
  },
  {
    tag: 'CLIMATE · UNITED NATIONS', accent: CLIM,
    headline: 'CLIMATE SUMMIT ENDS WITH NO DEAL',
    summary: 'UN talks close in failure, split over fossil fuels and climate finance.',
    icon: (x, y, s) => iconGlobe(x, y, s, WHITE, [255, 120, 90]),
  },
  {
    tag: 'HEALTH · UNITED STATES', accent: VIOL,
    headline: 'US LOSES MEASLES-FREE STATUS AFTER 25 YEARS',
    summary: 'Measles is endemic again after a quarter-century of elimination; Pennsylvania reports a ninth death.',
    icon: (x, y, s) => iconSyringe(x, y, s, WHITE, [255, 110, 130]),
  },
];

const GY = 514, CHH = 126, CGAP = 6, CW2 = (W - 2 * M - 16) / 2;
stories.forEach((st, i) => {
  const cx = M + (i % 2) * (CW2 + 16);
  const cy = GY + Math.floor(i / 2) * (CHH + CGAP);
  rect(cx, cy, CW2, CHH, CARD);
  frame(cx, cy, CW2, CHH, 1.4, INK);
  rect(cx + 13, cy + 25, 76, 76, st.accent);
  st.icon(cx + 13, cy + 25, 76);
  const tx = cx + 103, tw = CW2 - 103 - 13;
  text(SANS, 12.5, st.tag, tx, cy + 23, st.accent, { spacing: 1.1 });
  const headLines = wrap(SANS, 18.5, st.headline, tw);
  let hy = cy + 44;
  for (const ln of headLines.slice(0, 2)) { text(SANS, 18.5, ln, tx, hy, INK); hy += 20.5; }
  block(BODY, 13.5, st.summary, tx, cy + 102 - (2 - Math.min(2, headLines.length)) * 10, tw, 14.5, [52, 55, 62], 2);
});

// bottom band: sport flash + also-on-Tuesday briefs
const BY = GY + 3 * CHH + 2 * CGAP + 16; // 920
rect(M, BY - 8, W - 2 * M, 1.4, INK);
rect(M, BY, 40, 40, [14, 124, 91]);
iconTrophy(M, BY, 40, WHITE, [242, 176, 30]);
text(SANS, 16, 'SENEGAL RESTORED AS AFRICA CUP CHAMPIONS', M + 52, BY + 17, INK);
text(BODY, 13.5, "SPORT · AFRICA — The sports court upholds Senegal's appeal and hands back the AFCON title.", M + 52, BY + 37, [52, 55, 62]);
text(SANS, 12, 'ALSO ON TUESDAY', M, BY + 60, RED, { spacing: 1.4 });
text(BODY, 12.8, 'Turkish helicopter crash kills five · Nepal 5.6 quake · Sanofi buys Insmed for $41bn · UN urges AI safety rules', M + 142, BY + 60, [52, 55, 62]);

// footer
rect(M, 992, W - 2 * M, 1.2, MUTED);
text(BODY, 12.5, 'Sources: Reuters · AP · Daily Summary Of · Principia · Horizon · 10 Things — every story reported Tuesday 24 November 2026 · Drawn entirely by an AI agent', W / 2, 1013, MUTED, { align: 'center' });

// ------------------------------------------------------------------- run ----
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'entry.png'), encodePng());
