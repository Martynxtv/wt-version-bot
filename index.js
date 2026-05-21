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

if (fs.existsSync(CONFIG_FILE)) {
    try {
        servers = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch (e) {
        console.error("Failed to parse servers.json:", e.message);
        servers = {};
    }
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
                "User-Agent": "Mozilla/5.0 (VersionBot)"
            }
        });

        return String(res.data).trim();
    } catch (err) {
        console.error("Version fetch error:", url, err.message);
        return null;
    }
}

// ---------------- VERSION COMPARISON ----------------

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

// ---------------- STATUS ----------------

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

// ---------------- VERSION CHECKER ----------------

async function checkVersions() {
    console.log("[CHECK] Running version check...");

    const wipVersion = await getVersion(URLS.wip);
    const liveVersion = await getVersion(URLS.live);

    console.log("[API] WIP:", wipVersion, "LIVE:", liveVersion);

    if (!wipVersion || !liveVersion) {
        console.log("[SKIP] Missing version data");
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
        try {
            const channelId = servers[guildId]?.channelId;
            if (!channelId) continue;

            const channel = await client.channels.fetch(channelId).catch(() => null);

            if (!channel || channel.type !== ChannelType.GuildText) {
                console.log(`[WARN] Invalid channel for guild ${guildId}`);
                continue;
            }

            const embed = new EmbedBuilder()
                .setColor("#111111")
                .setTitle("War Thunder Version Tracker")
                .addFields(
                    {
                        name: "🟩 WIP (Dev Build)",
                        value: `\`${wipVersion}\``,
                        inline: true
                    },
                    {
                        name: "🟦 Live (Stable)",
                        value: `\`${liveVersion}\``,
                        inline: true
                    },
                    {
                        name: `${state.emoji} Status`,
                        value: state.message
                    }
                )
                .setFooter({ text: `State: ${state.status}` })
                .setTimestamp();

            await channel.send({ embeds: [embed] });

        } catch (err) {
            console.error(`Guild ${guildId} error:`, err.message);
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

        return message.reply(`Setup complete. Updates will go to ${channel}`);
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

// ---------------- READY ----------------

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    console.log("Running initial version check...");
    checkVersions();

    setInterval(checkVersions, 5 * 60 * 1000);
});

// ---------------- LOGIN ----------------

client.login(process.env.TOKEN)
    .then(() => console.log("Login successful"))
    .catch(err => console.error("Login failed:", err));
