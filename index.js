require("dotenv").config();

const fs = require("fs");
const axios = require("axios");

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField,
    ChannelType
} = require("discord.js");

console.log("Starting bot...");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ---------------- CONFIG ----------------

const CONFIG_FILE = "./servers.json";

let servers = {};

console.log("Loading servers.json...");

if (fs.existsSync(CONFIG_FILE)) {
    try {
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        servers = JSON.parse(raw);

        console.log("Servers loaded:", servers);
    } catch (err) {
        console.error("servers.json error:", err.message);
        servers = {};
    }
} else {
    console.log("servers.json NOT FOUND");
}

function saveServers() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(servers, null, 4));
}

// ---------------- API ----------------

const URLS = {
    wip: "https://yupmaster.gaijinent.com/yuitem/get_version.php?proj=warthunder&tag=dev",
    live: "https://yupmaster.gaijinent.com/yuitem/get_version.php?proj=warthunder"
};

let lastVersions = { wip: null, live: null };
let lastStatus = null;

async function getVersion(url) {
    try {
        const res = await axios.get(url, {
            timeout: 10000,
            headers: {
                "User-Agent": "Mozilla/5.0 (VersionBot-v15)"
            }
        });

        return String(res.data).trim();
    } catch (err) {
        console.error("API error:", url, err.message);
        return null;
    }
}

// ---------------- VERSION LOGIC ----------------

function compareVersions(a, b) {
    const pa = String(a).split(".").map(x => parseInt(x, 10) || 0);
    const pb = String(b).split(".").map(x => parseInt(x, 10) || 0);

    const len = Math.max(pa.length, pb.length);

    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;

        if (na > nb) return 1;
        if (na < nb) return -1;
    }

    return 0;
}

function analyzeStatus(wip, live) {
    const diff = compareVersions(wip, live);

    if (diff <= 0) {
        return {
            status: "LIVE_SYNCED",
            emoji: "🟢",
            message: "Live version is synced with current build."
        };
    }

    if (diff === 1) {
        return {
            status: "UPDATE_STAGING",
            emoji: "🟡",
            message: "New update staging detected."
        };
    }

    return {
        status: "TEST_SERVER_LIKELY",
        emoji: "🔴",
        message: "Test server / major update cycle likely active."
    };
}

// ---------------- CHECK LOOP ----------------

async function checkVersions() {
    console.log("\n[CHECK] Running version check...");

    const wipVersion = await getVersion(URLS.wip);
    const liveVersion = await getVersion(URLS.live);

    console.log("[API] WIP:", wipVersion, "| LIVE:", liveVersion);

    if (!wipVersion || !liveVersion) {
        console.log("[SKIP] Missing API data");
        return;
    }

    const state = analyzeStatus(wipVersion, liveVersion);

    const versionChanged =
        lastVersions.wip !== wipVersion ||
        lastVersions.live !== liveVersion;

    const statusChanged = lastStatus !== state.status;

    console.log("[STATE] versionChanged:", versionChanged, "statusChanged:", statusChanged);

    if (!versionChanged && !statusChanged) return;

    lastVersions = { wip: wipVersion, live: liveVersion };
    lastStatus = state.status;

    for (const guildId in servers) {
        const channelId = servers[guildId]?.channelId;
        if (!channelId) continue;

        console.log(`[SEND] Guild ${guildId} → ${channelId}`);

        try {
            const channel = await client.channels.fetch(channelId).catch(err => {
                console.error("[FETCH ERROR]", err.message);
                return null;
            });

            if (!channel || !channel.isTextBased()) {
                console.log("[WARN] Invalid channel:", channelId);
                continue;
            }

            const embed = new EmbedBuilder()
                .setColor("#111111")
                .setTitle("War Thunder Version Tracker")
                .addFields(
                    { name: "🟩 WIP", value: `\`${wipVersion}\``, inline: true },
                    { name: "🟦 Live", value: `\`${liveVersion}\``, inline: true },
                    { name: `${state.emoji} Status`, value: state.message }
                )
                .setFooter({ text: `State: ${state.status}` })
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            console.log("[SUCCESS] Message sent");

        } catch (err) {
            console.error("[SEND ERROR]", err.message);
        }
    }
}

// ---------------- COMMANDS ----------------

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith("!setup")) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply("You need Administrator permission.");
        }

        const channel = message.mentions.channels.first();

        if (!channel) {
            return message.reply("Usage: !setup #channel");
        }

        if (channel.type !== ChannelType.GuildText) {
            return message.reply("Please select a text channel.");
        }

        servers[message.guild.id] = {
            channelId: channel.id
        };

        saveServers();

        return message.reply(`Setup complete → ${channel}`);
    }

    if (message.content === "!version") {
        const wipVersion = await getVersion(URLS.wip);
        const liveVersion = await getVersion(URLS.live);

        const state = analyzeStatus(wipVersion, liveVersion);

        const embed = new EmbedBuilder()
            .setColor("#111111")
            .setTitle("War Thunder Versions")
            .addFields(
                { name: "🟩 WIP", value: `\`${wipVersion}\``, inline: true },
                { name: "🟦 Live", value: `\`${liveVersion}\``, inline: true },
                { name: `${state.emoji} Status`, value: state.message }
            )
            .setFooter({ text: `State: ${state.status}` })
            .setTimestamp();

        return message.reply({ embeds: [embed] });
    }
});

// ---------------- V15 READY ----------------

client.once("clientReady", (c) => {
    console.log(`Logged in as ${c.user.tag}`);

    console.log("Running initial version check...");
    checkVersions();

    setInterval(checkVersions, 5 * 60 * 1000);
});

// ---------------- LOGIN ----------------

client.login(process.env.TOKEN)
    .then(() => console.log("Login successful"))
    .catch(err => console.error("Login failed:", err));
