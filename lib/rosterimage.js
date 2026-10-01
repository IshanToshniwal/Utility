// Renders one roster card per department with @napi-rs/canvas. If canvas is not available
// the caller falls back to text cards.
const path = require('path');
let canvas = null;
try {
  canvas = require('@napi-rs/canvas');
  const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
  canvas.GlobalFonts.registerFromPath(path.join(FONT_DIR, 'DejaVuSans.ttf'), 'Sans');
  canvas.GlobalFonts.registerFromPath(path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'), 'SansBold');
} catch (err) {
  console.warn('@napi-rs/canvas not available — roster will use text cards:', err.message);
}

const C = { bg1: '#0f1117', bg2: '#171a24', panel: 'rgba(255,255,255,0.045)', stroke: 'rgba(255,255,255,0.09)', text: '#f3f5fa', muted: '#9aa1b5', accent: '#2dd4bf', accent2: '#6d8cff', loa: '#b48cff', green: '#3ddc84' };
const font = (size, bold = false) => `${size}px ${bold ? 'SansBold' : 'Sans'}`;
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
function renderDepartment(dept, { serverName = '', total = 0, onBreak = 0, index = 0 } = {}, createCanvas = canvas?.createCanvas) {
  const W = 900, PAD = 36, COLS = 2;
  const levels = dept.levels;
  // measure
  const rowH = 34, levelHead = 46, levelGap = 18;
  let H = 150;
  for (const l of levels) H += levelHead + Math.max(1, Math.ceil(l.members.length / COLS)) * rowH + levelGap;
  H += 30;
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, C.bg2);
  g.addColorStop(1, C.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // glow
  const rg = ctx.createRadialGradient(W * 0.9, -40, 10, W * 0.9, -40, 420);
  rg.addColorStop(0, 'rgba(45,212,191,0.22)');
  rg.addColorStop(1, 'rgba(45,212,191,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  const rg2 = ctx.createRadialGradient(0, H, 10, 0, H, 380);
  rg2.addColorStop(0, 'rgba(109,140,255,0.18)');
  rg2.addColorStop(1, 'rgba(109,140,255,0)');
  ctx.fillStyle = rg2;
  ctx.fillRect(0, 0, W, H);
  // accent bar
  const ag = ctx.createLinearGradient(0, 0, W, 0);
  ag.addColorStop(0, C.accent);
  ag.addColorStop(1, C.accent2);
  ctx.fillStyle = ag;
  ctx.fillRect(0, 0, W, 6);

  // header
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text;
  ctx.font = font(34, true);
  // server fonts rarely have colour emoji, so the department emoji stays in the text card only
  const title = dept.name.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F]/gu, '').trim() || dept.name;
  ctx.fillText(fit(ctx, title, W - PAD * 2 - 220), PAD, 66);
  ctx.font = font(16);
  ctx.fillStyle = C.muted;
  ctx.fillText(fit(ctx, `${serverName ? serverName + ' · ' : ''}Staff roster`, W - PAD * 2 - 220), PAD, 94);
  // count pill
  const pill = `${total} staff${onBreak ? ` · ${onBreak} on break` : ''}`;
  ctx.font = font(15, true);
  const pw = ctx.measureText(pill).width + 28;
  roundRect(ctx, W - PAD - pw, 44, pw, 34, 17);
  ctx.fillStyle = 'rgba(45,212,191,0.16)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(45,212,191,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.fillText(pill, W - PAD - pw + 14, 67);
  // divider
  ctx.fillStyle = C.stroke;
  ctx.fillRect(PAD, 118, W - PAD * 2, 1);

  let y = 140;
  const colW = (W - PAD * 2 - 20) / COLS;
  levels.forEach((l, li) => {
    const rows = Math.max(1, Math.ceil(l.members.length / COLS));
    const boxH = levelHead + rows * rowH;
    roundRect(ctx, PAD, y, W - PAD * 2, boxH, 14);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.strokeStyle = C.stroke;
    ctx.stroke();
    // level bar
    ctx.fillStyle = li === 0 ? C.accent : li === 1 ? C.accent2 : C.muted;
    roundRect(ctx, PAD, y + 12, 4, boxH - 24, 2);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = font(19, true);
    ctx.fillText(fit(ctx, l.name, colW), PAD + 20, y + 30);
    ctx.font = font(13);
    ctx.fillStyle = C.muted;
    const sub = `${l.members.length} member${l.members.length === 1 ? '' : 's'}${l.nick && l.nick !== l.name ? ` · tag: ${l.nick}` : ''}`;
    ctx.fillText(sub, W - PAD - 16 - ctx.measureText(sub).width, y + 30);
    ctx.font = font(16);
    if (!l.members.length) {
      ctx.fillStyle = C.muted;
      ctx.fillText('— nobody yet —', PAD + 20, y + levelHead + 22);
    }
    l.members.forEach((m, i) => {
      const cx = PAD + 20 + (i % COLS) * (colW + 20);
      const cy = y + levelHead + Math.floor(i / COLS) * rowH + 22;
      ctx.fillStyle = m.loa ? C.loa : C.green;
      ctx.beginPath();
      ctx.arc(cx + 6, cy - 6, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = m.loa ? C.muted : C.text;
      ctx.fillText(fit(ctx, m.name + (m.loa ? '  (on break)' : ''), colW - 30), cx + 20, cy);
    });
    y += boxH + levelGap;
  });
  // footer
  ctx.fillStyle = C.muted;
  ctx.font = font(12);
  ctx.fillText(`Updated ${new Date().toUTCString().replace(' GMT', ' UTC')}  ·  green = active, purple = on break`, PAD, H - 14);
  return cv.toBuffer('image/png');
}

module.exports = { available: () => Boolean(canvas), renderDepartment, _internals: { roundRect, fit, C, font } };
