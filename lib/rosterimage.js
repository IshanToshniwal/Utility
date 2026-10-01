// Renders one roster card per department with @napi-rs/canvas. If canvas is not available
// the caller falls back to text cards. Fonts come from the dejavu-fonts-ttf npm package
// (installed automatically), with assets/fonts as a fallback.
const path = require('path');
const fs = require('fs');
let canvas = null;
let fontsOk = false;
try {
  canvas = require('@napi-rs/canvas');
  const candidates = (file) => {
    const out = [];
    try { out.push(require.resolve(`dejavu-fonts-ttf/ttf/${file}`)); } catch {}
    out.push(path.join(__dirname, '..', 'assets', 'fonts', file));
    return out.find((f) => fs.existsSync(f));
  };
  const regular = candidates('DejaVuSans.ttf'), bold = candidates('DejaVuSans-Bold.ttf');
  if (regular && bold) {
    canvas.GlobalFonts.registerFromPath(regular, 'Sans');
    canvas.GlobalFonts.registerFromPath(bold, 'SansBold');
    fontsOk = true;
  } else console.warn('Roster fonts not found — run npm install (dejavu-fonts-ttf) or add assets/fonts; using system fonts.');
} catch (err) {
  console.warn('@napi-rs/canvas not available — roster will use text cards:', err.message);
}

const C = { bg1: '#0f1117', bg2: '#171a24', panel: 'rgba(255,255,255,0.045)', stroke: 'rgba(255,255,255,0.09)', text: '#f3f5fa', muted: '#9aa1b5', accent: '#2dd4bf', accent2: '#6d8cff', loa: '#b48cff', green: '#3ddc84' };
const font = (size, bold = false) => (fontsOk ? `${size}px ${bold ? 'SansBold' : 'Sans'}` : `${bold ? 'bold ' : ''}${size}px sans-serif`);
const clean = (s) => String(s || '').replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

// dept: { name, emoji, levels: [ { name, nick, members: [ { name, loa } ] } ] } (highest level first)
// returns PNG Buffer
function renderDepartment(dept, { serverName = '', total = 0, onBreak = 0 } = {}, createCanvas = canvas?.createCanvas) {
  const W = 900, PAD = 36, innerW = W - PAD * 2;
  const levelHead = 48, pillH = 34, pillGap = 8, levelPad = 14, levelGap = 16;
  // ---- measure first (pills wrap like text) ----
  const mctx = createCanvas(10, 10).getContext('2d');
  mctx.font = font(15, true);
  const levels = dept.levels.map((l) => {
    const pills = l.members.map((m) => {
      const label = clean(m.name) || '?';
      const w = Math.min(innerW - 40, mctx.measureText(label).width + 44 + (m.loa ? mctx.measureText(' · on break').width : 0));
      return { label, loa: m.loa, w };
    });
    const rows = [[]];
    let x = 0;
    for (const p of pills) {
      if (x + p.w > innerW - 40 && rows[rows.length - 1].length) { rows.push([]); x = 0; }
      rows[rows.length - 1].push(p);
      x += p.w + pillGap;
    }
    const bodyH = pills.length ? rows.length * (pillH + pillGap) - pillGap : pillH;
    return { ...l, pills, rows, boxH: levelHead + bodyH + levelPad };
  });
  const H = 136 + levels.reduce((n, l) => n + l.boxH + levelGap, 0) + 24;

  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.bg2);
  g.addColorStop(1, C.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W * 0.92, -20, 10, W * 0.92, -20, 460);
  rg.addColorStop(0, 'rgba(45,212,191,0.20)');
  rg.addColorStop(1, 'rgba(45,212,191,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  const rg2 = ctx.createRadialGradient(0, H, 10, 0, H, 420);
  rg2.addColorStop(0, 'rgba(109,140,255,0.16)');
  rg2.addColorStop(1, 'rgba(109,140,255,0)');
  ctx.fillStyle = rg2;
  ctx.fillRect(0, 0, W, H);
  const ag = ctx.createLinearGradient(0, 0, W, 0);
  ag.addColorStop(0, C.accent);
  ag.addColorStop(1, C.accent2);
  ctx.fillStyle = ag;
  ctx.fillRect(0, 0, W, 6);

  // ---- header ----
  ctx.textBaseline = 'alphabetic';
  const pill = `${total} staff${onBreak ? ` · ${onBreak} on break` : ''}`;
  ctx.font = font(15, true);
  const pw = ctx.measureText(pill).width + 30;
  ctx.fillStyle = C.text;
  ctx.font = font(32, true);
  ctx.fillText(fit(ctx, clean(dept.name) || dept.name, innerW - pw - 20), PAD, 64);
  ctx.font = font(15);
  ctx.fillStyle = C.muted;
  ctx.fillText(fit(ctx, `${clean(serverName) ? clean(serverName) + '  ·  ' : ''}Staff roster  ·  ${dept.levels.length} position${dept.levels.length === 1 ? '' : 's'}`, innerW - pw - 20), PAD, 92);
  roundRect(ctx, W - PAD - pw, 44, pw, 34, 17);
  ctx.fillStyle = 'rgba(45,212,191,0.14)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(45,212,191,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.font = font(15, true);
  ctx.fillText(pill, W - PAD - pw + 15, 67);
  ctx.fillStyle = C.stroke;
  ctx.fillRect(PAD, 116, innerW, 1);

  // ---- levels ----
  let y = 136;
  const rankColor = (i) => (i === 0 ? C.accent : i === 1 ? C.accent2 : i === 2 ? C.loa : C.muted);
  levels.forEach((l, li) => {
    roundRect(ctx, PAD, y, innerW, l.boxH, 14);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.strokeStyle = C.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = rankColor(li);
    roundRect(ctx, PAD, y + 14, 4, l.boxH - 28, 2);
    ctx.fill();
    // rank badge
    ctx.font = font(12, true);
    const badge = `#${li + 1}`;
    const bw = ctx.measureText(badge).width + 16;
    roundRect(ctx, PAD + 20, y + 15, bw, 20, 10);
    ctx.fillStyle = rankColor(li);
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = rankColor(li);
    ctx.fillText(badge, PAD + 28, y + 29);
    ctx.fillStyle = C.text;
    ctx.font = font(19, true);
    ctx.fillText(fit(ctx, clean(l.name), innerW - 260), PAD + 28 + bw, y + 31);
    ctx.font = font(13);
    ctx.fillStyle = C.muted;
    const sub = `${l.members.length} member${l.members.length === 1 ? '' : 's'}${l.nick && l.nick !== l.name ? `  ·  nickname tag: ${l.nick}` : ''}`;
    ctx.fillText(sub, W - PAD - 18 - ctx.measureText(sub).width, y + 31);
    let py = y + levelHead;
    if (!l.pills.length) {
      ctx.font = font(15);
      ctx.fillStyle = C.muted;
      ctx.fillText('No one in this position yet', PAD + 22, py + 22);
    }
    for (const row of l.rows) {
      let px = PAD + 20;
      for (const pl of row) {
        roundRect(ctx, px, py, pl.w, pillH, pillH / 2);
        ctx.fillStyle = pl.loa ? 'rgba(180,140,255,0.12)' : 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.strokeStyle = pl.loa ? 'rgba(180,140,255,0.45)' : 'rgba(255,255,255,0.12)';
        ctx.stroke();
        ctx.fillStyle = pl.loa ? C.loa : C.green;
        ctx.beginPath();
        ctx.arc(px + 17, py + pillH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = font(15, true);
        ctx.fillStyle = pl.loa ? C.muted : C.text;
        const txt = fit(ctx, pl.label, pl.w - 44 - (pl.loa ? ctx.measureText(' · on break').width : 0));
        ctx.fillText(txt, px + 30, py + pillH / 2 + 5);
        if (pl.loa) {
          const tw = ctx.measureText(txt).width;
          ctx.font = font(13);
          ctx.fillStyle = C.loa;
          ctx.fillText(' · on break', px + 30 + tw + 4, py + pillH / 2 + 5);
        }
        px += pl.w + pillGap;
      }
      py += pillH + pillGap;
    }
    y += l.boxH + levelGap;
  });
  ctx.fillStyle = C.muted;
  ctx.font = font(12);
  ctx.fillText(`Updated ${new Date().toUTCString().replace(' GMT', ' UTC')}   ·   green = active   ·   purple = on break`, PAD, H - 12);
  return cv.toBuffer('image/png');
}

module.exports = { available: () => Boolean(canvas), fontsOk: () => fontsOk, renderDepartment, _internals: { roundRect, fit, C, font } };
