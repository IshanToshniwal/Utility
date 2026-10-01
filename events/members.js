const { Events } = require('discord.js');
const store = require('../lib/store');
const team = require('../lib/team');
const { COLORS, card, msg } = require('../lib/ui');

module.exports = [
  {
    name: Events.GuildMemberAdd,
    async execute(client, member) {
      const t = store.teamFor(member.guild.id);
      if (!t || member.user.bot) return;
      const m = t.members[member.id];
      if (m && m.status !== 'resigned') {
        await team.syncMember(client, t, member.id, 'Rejoined server');
        if (member.guild.id === t.mainGuildId) await team.post(client, t, 'log', msg(card({ color: COLORS.blue, title: '🔄 Roles restored', text: `<@${member.id}> (${team.positionFull(t, m)}) joined the main server — roles and nickname applied.` })));
        return;
      }
      if (member.guild.id === t.staffGuildId) {
        const app = Object.values(t.applications).filter((a) => a.userId === member.id).sort((a, b) => b.at.localeCompare(a.at))[0];
        if (app?.status === 'accepted') {
          if (t.roles.pendingStaff) await member.roles.add(t.roles.pendingStaff, 'Accepted applicant joined').catch(() => null);
          await team.post(client, t, 'applications', msg(card({ color: COLORS.yellow, title: '🚪 Accepted applicant joined', text: `<@${member.id}> (application #${app.id}) just joined the staff server.\n${t.channels.proof ? `They should post their proof in <#${t.channels.proof}>; it will appear in the verification channel for approval.` : `Verify them with \`/verify user:@${member.user.username} position:…\` once you have checked their proof.`}` }), { content: team.mgrPing(t) }));
          if (t.channels.proof) {
            const ch = member.guild.channels.cache.get(t.channels.proof);
            if (ch?.isTextBased()) await ch.send(msg(card({ color: COLORS.teal, title: '👋 Welcome!', text: `<@${member.id}>, your application was accepted. Please post your **proof** (screenshot) here — or use \`/proof\` — and a manager will verify you and give you your position.` }), { content: `<@${member.id}>` })).catch(() => null);
          }
        }
      }
    },
  },
  {
    name: Events.GuildMemberRemove,
    async execute(client, member) {
      const t = store.teamFor(member.guild.id);
      if (!t) return;
      const m = t.members[member.id];
      if (!m || m.status === 'resigned') return;
      const which = member.guild.id === t.staffGuildId ? 'staff' : 'main';
      await team.post(client, t, 'log', msg(card({ color: COLORS.orange, title: '⚠️ Staff member left a server', text: `<@${member.id}> (${team.positionFull(t, m)}) left the **${which} server**. They are still on the roster — use \`/staff remove\` if they are gone for good.` })));
    },
  },
  {
    name: Events.GuildMemberUpdate,
    async execute(client, oldM, newM) {
      const t = store.teamFor(newM.guild.id);
      if (!t) return;
      const m = t.members[newM.id];
      if (!m || m.status === 'resigned' || oldM.nickname === newM.nickname) return;
      const want = team.nickFor(t, m);
      if (newM.nickname !== want && newM.id !== newM.guild.ownerId) await newM.setNickname(want, 'StaffHub nickname format').catch(() => null);
    },
  },
];
