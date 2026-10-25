const {
  Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes, Events, ChannelType,
} = require('discord.js');
const fs = require('fs');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const DATA_FILE = process.env.DATA_FILE || './data.json';

// ---------- CONFIG (edit freely) ----------
const GOAL = { messages: 1500, people: 5 }; // 5 members with 1,500 messages each
const TIERS = [                              // role names have no emojis
  { messages: 500,  role: '500 Messages' },
  { messages: 1000, role: '1K Messages' },
  { messages: 1500, role: '1.5K Messages' },
  { messages: 2500, role: '2.5K Messages' },
  { messages: 5000, role: '5K Messages' },
];
const EMBED_AT = 5000;
const EMBED_ROLE = 'Embed Perms';
const COLOR = 0x2ecc71;
// ------------------------------------------

let db = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};
let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DATA_FILE, JSON.stringify(db)), 3000);
};
const g = (id) => (db[id] ??= { counts: {}, goalDone: false, sneakPeek: 'A sneak peek is coming soon!' });

const bar = (v, max, size = 20) => {
  const f = Math.round(Math.min(v / max, 1) * size);
  return '█'.repeat(f) + '░'.repeat(size - f) + ` ${Math.min(Math.round((v / max) * 100), 100)}%`;
};
const peopleAtGoal = (gd) => Object.values(gd.counts).filter((n) => n >= GOAL.messages).length;

async function getRole(guild, name, permissions = []) {
  await guild.roles.fetch();
  return (
    guild.roles.cache.find((r) => r.name.toLowerCase() === name.toLowerCase()) ??
    guild.roles.create({ name, permissions, reason: 'Engagement bot' })
  );
}

function communityEmbed(gd) {
  const n = peopleAtGoal(gd);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('Community Engagement Goal')
    .setDescription(
      `**${GOAL.people} members** need to reach **${GOAL.messages.toLocaleString()} messages** to unlock the sneak peek.\n\n` +
      `\`${bar(n, GOAL.people)}\`\n**${Math.min(n, GOAL.people)} / ${GOAL.people}** members` +
      (gd.goalDone ? '\n\n**Goal reached!**' : '')
    )
    .setTimestamp();
}

async function refreshPanel(guild) {
  const gd = g(guild.id);
  if (!gd.panelChannel || !gd.panelMessage) return;
  try {
    const ch = await guild.channels.fetch(gd.panelChannel);
    const msg = await ch.messages.fetch(gd.panelMessage);
    await msg.edit({ embeds: [communityEmbed(gd)] });
  } catch {}
}

async function checkGoal(guild) {
  const gd = g(guild.id);
  await refreshPanel(guild);
  if (gd.goalDone || peopleAtGoal(gd) < GOAL.people) return;
  gd.goalDone = true;
  save();
  await refreshPanel(guild);
  try {
    const ch = await guild.channels.fetch(gd.panelChannel);
    await ch.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('Goal reached!')
          .setDescription(
            `${GOAL.people} members have reached ${GOAL.messages.toLocaleString()} messages. The goal has been reached!\n\n**Sneak peek:**\n${gd.sneakPeek}`
          ),
      ],
    });
  } catch {}
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.on(Events.MessageCreate, async (m) => {
  if (m.author.bot || !m.guild) return;
  const gd = g(m.guild.id);
  const before = (gd.counts[m.author.id] ??= 0);
  const now = (gd.counts[m.author.id] = before + 1);
  save();

  const crossed = TIERS.filter((t) => before < t.messages && now >= t.messages);
  for (const t of crossed) {
    try {
      const role = await getRole(m.guild, t.role);
      await m.member.roles.add(role);
    } catch (e) { console.error('Role error:', e.message); }
  }
  if (before < EMBED_AT && now >= EMBED_AT) {
    try {
      const role = await getRole(m.guild, EMBED_ROLE, [
        PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
      ]);
      await m.member.roles.add(role);
    } catch (e) { console.error('Embed role error:', e.message); }
  }
  if (before < GOAL.messages && now >= GOAL.messages) await checkGoal(m.guild);
});

client.on(Events.InteractionCreate, async (i) => {
  const gd = i.guild ? g(i.guild.id) : null;

  if (i.isChatInputCommand()) {
    if (i.commandName === 'setup-engagement') {
      await i.deferReply({ ephemeral: true });
      const ch = i.options.getChannel('channel');
      for (const t of TIERS) await getRole(i.guild, t.role);
      await getRole(i.guild, EMBED_ROLE, [PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles]);
      const msg = await ch.send({ embeds: [communityEmbed(gd)] });
      gd.panelChannel = ch.id;
      gd.panelMessage = msg.id;
      save();
      return i.editReply('Engagement panel created and roles are ready.');
    }
    if (i.commandName === 'setup-member-panel') {
      const ch = i.options.getChannel('channel');
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('my_engagement').setLabel('My Engagement').setStyle(ButtonStyle.Success)
      );
      await ch.send({
        embeds: [
          new EmbedBuilder().setColor(COLOR).setTitle('Your Engagement Panel')
            .setDescription('Click the button below to see your messages, your progress and your roles.'),
        ],
        components: [row],
      });
      return i.reply({ content: 'Member panel posted.', ephemeral: true });
    }
    if (i.commandName === 'set-sneakpeek') {
      gd.sneakPeek = i.options.getString('text');
      save();
      return i.reply({ content: 'Sneak peek text saved.', ephemeral: true });
    }
  }

  if (i.isButton() && i.customId === 'my_engagement') {
    const n = gd.counts[i.user.id] ?? 0;
    const next = TIERS.find((t) => n < t.messages);
    const earned = TIERS.filter((t) => n >= t.messages).map((t) => t.role);
    if (n >= EMBED_AT) earned.push(EMBED_ROLE);
    const e = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`${i.member.displayName}'s Engagement`)
      .addFields(
        { name: 'Messages', value: n.toLocaleString(), inline: true },
        { name: 'Roles earned', value: earned.length ? earned.join('\n') : 'None yet', inline: true },
        {
          name: next ? `Next: ${next.role} (${next.messages.toLocaleString()})` : 'All tiers completed',
          value: `\`${bar(n, next ? next.messages : TIERS.at(-1).messages)}\``,
        }
      );
    return i.reply({ embeds: [e], ephemeral: true });
  }
});

client.once(Events.ClientReady, async () => {
  const admin = PermissionFlagsBits.Administrator;
  const chOpt = (o) => o.setName('channel').setDescription('Channel').addChannelTypes(ChannelType.GuildText).setRequired(true);
  const cmds = [
    new SlashCommandBuilder().setName('setup-engagement').setDescription('Post the community engagement panel')
      .addChannelOption(chOpt).setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('setup-member-panel').setDescription('Post the member panel button')
      .addChannelOption(chOpt).setDefaultMemberPermissions(admin),
    new SlashCommandBuilder().setName('set-sneakpeek').setDescription('Set the sneak peek revealed at the goal')
      .addStringOption((o) => o.setName('text').setDescription('Sneak peek text').setRequired(true))
      .setDefaultMemberPermissions(admin),
  ].map((c) => c.toJSON());
  await new REST({ version: '10' }).setToken(TOKEN).put(Routes.applicationCommands(CLIENT_ID), { body: cmds });
  console.log(`Logged in as ${client.user.tag}`);
});

client.login(TOKEN);
