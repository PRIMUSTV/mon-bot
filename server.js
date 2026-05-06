// ============================================
// WarCrateBot - Serveur API + Bot Discord
// ============================================
// Hébergé sur Railway
// Variables d'environnement à configurer dans Railway :
//   DISCORD_TOKEN  → token de ton bot Discord
//   CHANNEL_ID     → ID du channel Discord
//   ROLE_ID        → ID du rôle à ping 15 min avant le drop

const express = require("express");
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cors = require("cors");

// ============================================
// ⚙️  CONFIGURATION — via variables Railway
// ============================================
const CONFIG = {
  PORT: process.env.PORT || 3000,
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  CHANNEL_ID: process.env.CHANNEL_ID,
  ROLE_ID: process.env.ROLE_ID,             // Rôle pingé 15 min avant le drop
  CRATE_INTERVAL_MINUTES: 45,
  ANTI_SPAM_SECONDS: 60,
};

if (!CONFIG.DISCORD_TOKEN || !CONFIG.CHANNEL_ID) {
  console.error("❌ DISCORD_TOKEN ou CHANNEL_ID manquant dans Railway > Variables !");
  process.exit(1);
}
if (!CONFIG.ROLE_ID) {
  console.warn("⚠️  ROLE_ID non défini — rappels sans ping de rôle.");
}

// ============================================
// 🗄️  Base de données en mémoire
// ============================================
const crateData = {};
// { "Hallowfall": { lastDrop, nextDrop, x, y, reporter, reminderSent } }

// ============================================
// 🤖  Bot Discord
// ============================================
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

discordClient.once("ready", () => {
  console.log(`✅ Bot Discord connecté en tant que ${discordClient.user.tag}`);
});

discordClient.login(CONFIG.DISCORD_TOKEN);

// ============================================
// 🎨  Données visuelles par zone
// ============================================
const ZONE_COLORS = {
  "Hallowfall":        0xf4a460,
  "Isle of Dorn":      0x4682b4,
  "The Ringing Deeps": 0x9370db,
  "Azj-Kahet":         0xdc143c,
  "The Waking Shores": 0xff6347,
  "Ohn'ahran Plains":  0x32cd32,
  "The Azure Span":    0x00bfff,
  "Thaldraszus":       0xffd700,
  "default":           0xe8c56e,
};

const ZONE_EMOJIS = {
  "Hallowfall":        "🌑",
  "Isle of Dorn":      "🏝️",
  "The Ringing Deeps": "⛏️",
  "Azj-Kahet":         "🕷️",
  "The Waking Shores": "🌋",
  "Ohn'ahran Plains":  "🌿",
  "The Azure Span":    "❄️",
  "Thaldraszus":       "✨",
  "default":           "📦",
};

// ============================================
// 📢  Notification : Drop détecté
// ============================================
async function sendDropNotification(data) {
  try {
    const channel = await discordClient.channels.fetch(CONFIG.CHANNEL_ID);
    if (!channel) return console.error("❌ Channel Discord introuvable");

    const zone = data.zone;
    const color = ZONE_COLORS[zone] || ZONE_COLORS.default;
    const emoji = ZONE_EMOJIS[zone] || ZONE_EMOJIS.default;
    const nextDropTimestamp = data.timestamp + CONFIG.CRATE_INTERVAL_MINUTES * 60;
    const reminderTimestamp = nextDropTimestamp - 15 * 60;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`${emoji} Fourniture de Guerre détectée !`)
      .setDescription(`Un drop vient d'être signalé en **${zone}**`)
      .addFields(
        { name: "📍 Zone",          value: zone,                                    inline: true },
        { name: "🗺️ Coordonnées",   value: `${data.x.toFixed(1)}, ${data.y.toFixed(1)}`, inline: true },
        { name: "👤 Signalé par",   value: data.reporter || "Inconnu",              inline: true },
        { name: "⏰ Prochain drop", value: `<t:${nextDropTimestamp}:R> (<t:${nextDropTimestamp}:T>)`, inline: false },
        { name: "🔔 Rappel prévu",  value: `Ping <t:${reminderTimestamp}:T> (15 min avant)`, inline: false }
      )
      .setFooter({ text: "WarCrateBot • Drops toutes les ~45 minutes" })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    console.log(`📢 Notification drop envoyée pour ${zone}`);
  } catch (err) {
    console.error("❌ Erreur notification drop:", err.message);
  }
}

// ============================================
// 🔔  Rappel : 15 minutes avant le drop
// ============================================
async function sendReminderNotification(zone, data) {
  try {
    const channel = await discordClient.channels.fetch(CONFIG.CHANNEL_ID);
    if (!channel) return;

    const emoji = ZONE_EMOJIS[zone] || "📦";
    const color = ZONE_COLORS[zone] || ZONE_COLORS.default;
    const roleMention = CONFIG.ROLE_ID ? `<@&${CONFIG.ROLE_ID}>` : "";

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`🚨 Drop dans 15 minutes — ${zone} !`)
      .setDescription(
        `${emoji} La fourniture de guerre arrive en **${zone}** dans ~15 minutes !\n` +
        `Rendez-vous aux coordonnées **${data.x.toFixed(1)}, ${data.y.toFixed(1)}**`
      )
      .addFields(
        { name: "📍 Zone",          value: zone,                                    inline: true },
        { name: "🗺️ Coordonnées",   value: `${data.x.toFixed(1)}, ${data.y.toFixed(1)}`, inline: true },
        { name: "⏰ Heure d'arrivée", value: `<t:${data.nextDrop}:R> (<t:${data.nextDrop}:T>)`, inline: false }
      )
      .setFooter({ text: "Prépare ta monture ! 🐴" })
      .setTimestamp();

    // Ping du rôle en contenu + embed
    await channel.send({
      content: roleMention ? `${roleMention} ⚔️ Drop imminent !` : "⚔️ Drop imminent !",
      embeds: [embed],
    });

    console.log(`🔔 Rappel 15min envoyé pour ${zone}${CONFIG.ROLE_ID ? " (avec ping rôle)" : ""}`);
  } catch (err) {
    console.error("❌ Erreur rappel:", err.message);
  }
}

// ============================================
// 🌐  Serveur API Express
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

// Reçoit les données de l'addon WoW
app.post("/crate", async (req, res) => {
  const { zone, x, y, timestamp, reporter } = req.body;

  if (!zone || !timestamp) {
    return res.status(400).json({ error: "Données manquantes (zone, timestamp)" });
  }

  console.log(`📦 Drop reçu: ${zone} à (${x}, ${y}) par ${reporter}`);

  // Anti-spam : ignore si même zone dans les 60 dernières secondes
  const existing = crateData[zone];
  if (existing && timestamp - existing.lastDrop < CONFIG.ANTI_SPAM_SECONDS) {
    console.log(`⏭️  Doublon ignoré pour ${zone}`);
    return res.json({ status: "ignored", reason: "duplicate" });
  }

  crateData[zone] = {
    lastDrop: timestamp,
    nextDrop: timestamp + CONFIG.CRATE_INTERVAL_MINUTES * 60,
    x: x || 0,
    y: y || 0,
    reporter: reporter || "Inconnu",
    reminderSent: false, // ← Sera passé à true une fois le rappel envoyé
  };

  await sendDropNotification({ zone, x: x || 0, y: y || 0, timestamp, reporter });

  res.json({ status: "ok", zone, nextDrop: crateData[zone].nextDrop });
});

// Statut de toutes les zones
app.get("/status", (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const status = {};
  for (const [zone, data] of Object.entries(crateData)) {
    const secsUntilNext = data.nextDrop - now;
    status[zone] = {
      lastDrop: new Date(data.lastDrop * 1000).toISOString(),
      nextDrop: new Date(data.nextDrop * 1000).toISOString(),
      minutesUntilNext: Math.max(0, Math.floor(secsUntilNext / 60)),
      coords: { x: data.x, y: data.y },
      reporter: data.reporter,
      reminderSent: data.reminderSent,
    };
  }
  res.json(status);
});

// Santé du serveur
app.get("/", (req, res) => {
  res.json({ status: "WarCrateBot en ligne ✅", zones: Object.keys(crateData).length });
});

// ============================================
// ⏰  Boucle de rappels (toutes les 30 secondes)
// ============================================
setInterval(async () => {
  const now = Math.floor(Date.now() / 1000);

  for (const [zone, data] of Object.entries(crateData)) {
    const secsUntilNext = data.nextDrop - now;

    // Fenêtre : entre 14m30 et 15m30 avant le drop, et pas encore envoyé
    if (!data.reminderSent && secsUntilNext > 840 && secsUntilNext <= 930) {
      data.reminderSent = true; // Marquer avant l'envoi pour éviter les doublons
      await sendReminderNotification(zone, data);
    }
  }
}, 30000);

// Démarrage
app.listen(CONFIG.PORT, () => {
  console.log(`🚀 WarCrateBot démarré sur le port ${CONFIG.PORT}`);
  console.log(`📡 En attente des drops WoW...`);
});
