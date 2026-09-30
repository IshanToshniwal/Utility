const { EmbedBuilder, MessageFlags } = require('discord.js');

const COLORS = { blue: 0x5865f2, green: 0x3ddc84, red: 0xff5c6c, yellow: 0xffc857, purple: 0x9b6bff, grey: 0x99aab5, orange: 0xff8c50 };

const UNITS = { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3, w: 604800e3 };
function parseDuration(str) {
  if (!str) return null;
  const m = String(str).trim().toLowerCase().match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|w|week|weeks)?$/);
  if (!m) {
    // compound like 1d12h
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

const embed = (color, title, description) => {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(title);
  if (description) e.setDescription(description);
  return e;
};
const ok = (interaction, text) => reply(interaction, { embeds: [embed(COLORS.green, null, `✅ ${text}`)] });
const fail = (interaction, text) => reply(interaction, { embeds: [embed(COLORS.red, null, `❌ ${text}`)], flags: MessageFlags.Ephemeral });
async function reply(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}
const ts = (d, style = 'R') => `<t:${Math.floor(new Date(d).getTime() / 1000)}:${style}>`;

module.exports = { COLORS, parseDuration, formatDuration, embed, ok, fail, reply, ts };
