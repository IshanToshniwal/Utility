const ui = require('./ui');

const COLORS = ui.COLORS;

const UNITS = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 };
function parseDuration(str) {
  if (!str) return null;
  const m = String(str).trim().toLowerCase().match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|week|weeks)?$/);
  if (!m) {
    let total = 0;
    let ok = false;
    for (const part of String(str).toLowerCase().matchAll(/(\d+)\s*([smhdw])/g)) {
      total += Number(part[1]) * UNITS[part[2]];
      ok = true;
    }
    return ok ? total : null;
  }
  return Number(m[1]) * UNITS[(m[2] || 'm')[0]];
}
function formatDuration(ms) {
  if (ms == null) return '—';
  const d = Math.floor(ms / 86400e3), h = Math.floor((ms % 86400e3) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}

async function reply(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}
const ok = (interaction, text) => reply(interaction, ui.ok(text));
const fail = (interaction, text) => reply(interaction, ui.fail(text, { ephemeral: !(interaction.deferred || interaction.replied) }));
const ts = (d, style = 'R') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;
const day = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

module.exports = { COLORS, parseDuration, formatDuration, ok, fail, reply, ts, day };
