require("dotenv").config();

const fs = require("fs");
const axios = require("axios");

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField
} = require("discord.js");

console.log("Starting bot...");

// ---------------- CLIENT ----------------

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

function loadServers() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify({}, null, 4));
        }

        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        servers = raw ? JSON.parse(raw) : {};

        console.log("[CONFIG] Loaded servers:", servers);

    } catch (err) {
        console.error("[CONFIG ERROR]", err.message);
        servers = {};
    }
}

function saveServers() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(servers, null, 4));
        console.log("[CONFIG] Saved servers.json");
    } catch (err) {
        console.error("[CONFIG SAVE ERROR]", err.message);
    }
}

loadServers();

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
        console.error("[API ERROR]", url, err.message);
        return null;
    }
}

// ---------------- VERSION LOGIC ----------------

function versionParts(v) {
    return String(v)
        .split(".")
        .map(n => parseInt(n, 10) || 0);
}

function versionCompare(a, b) {
    const pa = versionParts(a);
    const pb = versionParts(b);

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
    const cmp = versionCompare(wip, live);

    // identical versions
    if (cmp === 0) {
        return {
            status: "LIVE_SYNCED",
            emoji: "🟢",
            message: "Live version is synced with current build."
        };
    }

    // WIP ahead
    if (cmp === 1) {
        const wp = versionParts(wip);
        const lp = versionParts(live);

        // compare LAST version number only
        const lastDiff =
            (wp[wp.length - 1] || 0) -
            (lp[lp.length - 1] || 0);

        // 2 or more versions ahead
        if (lastDiff >= 2) {
            return {
                status: "TEST_SERVER_LIKELY",
                emoji: "🔴",
                message: "Test server / major update cycle likely active."
            };
        }

        // only 1 version ahead
        return {
            status: "UPDATE_STAGING",
            emoji: "🟡",
            message: "New update staging detected."
        };
    }

    // LIVE ahead of WIP
    return {
        status: "ROLLBACK_OR_TEST",
        emoji: "🟠",
        message: "Live is ahead of WIP (rollback or mismatch detected)."
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

    const statusChanged =
        lastStatus !== state.status;

    console.log(
        "[STATE]",
        state.status,
        "| versionChanged:",
        versionChanged,
        "| statusChanged:",
        statusChanged
    );

    if (!versionChanged && !statusChanged) return;

    lastVersions = {
        wip: wipVersion,
        live: liveVersion
    };

    lastStatus = state.status;

    const embed = new EmbedBuilder()
        .setColor("#111111")
        .setTitle("War Thunder Version Tracker")
        .addFields(
            {
                name: "🟩 WIP",
                value: `\`${wipVersion}\``,
                inline: true
            },
            {
                name: "🟦 Live",
                value: `\`${liveVersion}\``,
                inline: true
            },
            {
                name: `${state.emoji} Status`,
                value: state.message
            }
        )
        .setFooter({
            text: `State: ${state.status}`
        })
        .setTimestamp();

    for (const guildId of Object.keys(servers)) {
        const channelId = servers[guildId]?.channelId;

        if (!channelId) continue;

        console.log(`[SEND] Guild ${guildId} → ${channelId}`);

        try {
            const channel = await client.channels
                .fetch(channelId)
                .catch(() => null);

            if (!channel || !channel.isTextBased()) {
                console.log(`[WARN] Invalid channel: ${channelId}`);
                continue;
            }

            await channel.send({
                embeds: [embed]
            });

            console.log(`[SUCCESS] Posted to guild ${guildId}`);

        } catch (err) {
            console.error(
                `[SEND ERROR] Guild ${guildId}:`,
                err.message
            );
        }
    }
}

// ---------------- COMMANDS ----------------

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;

    // SETUP
    if (message.content.startsWith("!setup")) {

        if (
            !message.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return message.reply(
                "You need Administrator permission."
            );
        }

        const channel =
            message.mentions.channels.first();

        if (!channel) {
            return message.reply(
                "Usage: !setup #channel"
            );
        }

        if (!channel.isTextBased()) {
            return message.reply(
                "Please select a text channel."
            );
        }

        const guildId = message.guild.id;

        servers[guildId] = {
            channelId: channel.id
        };

        saveServers();

        console.log(
            `[SETUP] Guild ${guildId} → Channel ${channel.id}`
        );

        return message.reply(
            `Setup complete. Updates will go to ${channel}`
        );
    }

    // MANUAL VERSION CHECK
    if (message.content === "!version") {

        const wipVersion = await getVersion(URLS.wip);
        const liveVersion = await getVersion(URLS.live);

        const state = analyzeStatus(
            wipVersion,
            liveVersion
        );

        const embed = new EmbedBuilder()
            .setColor("#111111")
            .setTitle("War Thunder Versions")
            .addFields(
                {
                    name: "🟩 WIP",
                    value: `\`${wipVersion}\``,
                    inline: true
                },
                {
                    name: "🟦 Live",
                    value: `\`${liveVersion}\``,
                    inline: true
                },
                {
                    name: `${state.emoji} Status`,
                    value: state.message
                }
            )
            .setFooter({
                text: `State: ${state.status}`
            })
            .setTimestamp();

        return message.reply({
            embeds: [embed]
        });
    }
});

// ---------------- READY ----------------

client.once("clientReady", (c) => {

    console.log(`Logged in as ${c.user.tag}`);

    console.log("Running initial version check...");

    checkVersions();

    // every 5 minutes
    setInterval(
        checkVersions,
        5 * 60 * 1000
    );
});

// ---------------- LOGIN ----------------

client.login(process.env.TOKEN)
    .then(() => console.log("Login successful"))
    .catch(err =>
        console.error("Login failed:", err)
    );
