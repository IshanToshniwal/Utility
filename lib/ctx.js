// Small helpers shared by commands.
const store = require('./store');
const team = require('./team');
const ui = require('./ui');

async function getTeam(interaction, { silent = false } = {}) {
  const t = store.teamFor(interaction.guildId);
  if (!t && !silent) await interaction.reply(ui.fail('This server is not linked to a staff server yet. An admin must run `/link setup` in the **main** server first.'));
  return t;
}
async function requireManager(interaction, t) {
  if (await team.isManager(interaction.client, t, interaction.user.id)) return true;
  await interaction.reply(ui.fail('Only staff managers (or admins) can use this.'));
  return false;
}
function isStaffGuild(interaction, t) {
  return interaction.guildId === t.staffGuildId;
}
function positionChoices(t, query = '') {
  const q = query.toLowerCase();
  const out = [];
  for (const d of t.departments) for (const l of d.levels) {
    const name = `${d.name} / ${l.name}`;
    if (!q || name.toLowerCase().includes(q)) out.push({ name: name.slice(0, 100), value: l.id });
  }
  return out.slice(0, 25);
}
function departmentChoices(t, query = '') {
  const q = query.toLowerCase();
  return t.departments.filter((d) => !q || d.name.toLowerCase().includes(q)).slice(0, 25).map((d) => ({ name: d.name.slice(0, 100), value: d.id }));
}
function resolvePosition(t, value) {
  for (const d of t.departments) for (const l of d.levels) if (l.id === value) return { dept: d, level: l };
  return team.findPosition(t, value);
}
async function autocompletePosition(interaction) {
  const t = store.teamFor(interaction.guildId);
  const focused = interaction.options.getFocused(true);
  if (!t) return interaction.respond([]);
  if (focused.name === 'department') return interaction.respond(departmentChoices(t, focused.value));
  return interaction.respond(positionChoices(t, focused.value));
}

module.exports = { getTeam, requireManager, isStaffGuild, positionChoices, departmentChoices, resolvePosition, autocompletePosition };
