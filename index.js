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

let lastVersions = {
    wip: null,
    live: null
};

async function getVersion(url) {
    try {
        const res = await axios.get(url);
        return res.data.trim();
    } catch (err) {
        console.error("Version fetch error:", err.message);
        return null;
    }
}

async function checkVersions() {
    const wipVersion = await getVersion(URLS.wip);
    const liveVersion = await getVersion(URLS.live);

    if (!wipVersion || !liveVersion) return;

    if (
        lastVersions.wip === wipVersion &&
        lastVersions.live === liveVersion
    ) return;

    lastVersions = { wip: wipVersion, live: liveVersion };

    for (const guildId in servers) {
        try {
            const channelId = servers[guildId].channelId;
            const channel = await client.channels.fetch(channelId);

            if (!channel) continue;

            const embed = new EmbedBuilder()
                .setColor("#111111")
                .setTitle("Version Watcher APP")
                .addFields(
                    {
                        name: "🟩 WIP",
                        value: `Current: \`${wipVersion}\``
                    },
                    {
                        name: "🟦 Live",
                        value: `Current: \`${liveVersion}\``
                    }
                )
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

    // !setup
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

    // !version
    if (message.content === "!version") {

        const wipVersion = await getVersion(URLS.wip);
        const liveVersion = await getVersion(URLS.live);

        const embed = new EmbedBuilder()
            .setColor("#111111")
            .setTitle("War Thunder Versions")
            .addFields(
                {
                    name: "🟩 WIP",
                    value: `\`${wipVersion}\``
                },
                {
                    name: "🟦 Live",
                    value: `\`${liveVersion}\``
                }
            );

        return message.reply({ embeds: [embed] });
    }
});

// ---------------- READY EVENT (FIXED) ----------------

client.once("clientReady", () => {
    console.log(`Logged in as ${client.user.tag}`);

    checkVersions();
    setInterval(checkVersions, 5 * 60 * 1000);
});
// ---------------- LOGIN ----------------

client.login(process.env.TOKEN)
    .then(() => console.log("Login successful"))
    .catch(err => console.error("Login failed:", err));