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
    servers = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
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
        const res = await axios.get(url);
        return res.data.trim();
    } catch (err) {
        console.error("Version fetch error:", err.message);
        return null;
    }
}

// ---------------- STATUS ----------------

function analyzeStatus(wip, live) {
    const w = parseInt(wip);
    const l = parseInt(live);

    if (isNaN(w) || isNaN(l)) {
        return {
            status: "UNKNOWN",
            emoji: "⚪",
            message: "Unable to determine update state."
        };
    }

    const diff = w - l;

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

// ---------------- CHECKER ----------------

async function checkVersions() {

    const wipVersion = await getVersion(URLS.wip);
    const liveVersion = await getVersion(URLS.live);

    if (!wipVersion || !liveVersion) return;

    const state = analyzeStatus(wipVersion, liveVersion);

    const versionChanged =
        lastVersions.wip !== wipVersion ||
        lastVersions.live !== liveVersion;

    const statusChanged = lastStatus !== state.status;

    if (!versionChanged && !statusChanged) return;

    lastVersions = { wip: wipVersion, live: liveVersion };
    lastStatus = state.status;

    for (const guildId in servers) {
        try {

            const channelId = servers[guildId].channelId;
            const channel = await client.channels.fetch(channelId);

            if (!channel) continue;

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

        if (!channel) return message.reply("Usage: !setup #channel");

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

        return message.reply({ embeds: [embed] });
    }
});

// ---------------- READY (FIXED) ----------------

client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);

    checkVersions();
    setInterval(checkVersions, 5 * 60 * 1000);
});

// ---------------- LOGIN ----------------

client.login(process.env.TOKEN)
    .then(() => console.log("Login successful"))
    .catch(err => console.error("Login failed:", err));
