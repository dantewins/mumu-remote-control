import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const targetRequired = (o) =>
    o.setName("target")
        .setDescription("ADB device serial (type to autocomplete)")
        .setRequired(true)
        .setAutocomplete(true);

const targetOptional = (o) =>
    o.setName("target")
        .setDescription("ADB device serial (type to autocomplete)")
        .setRequired(false)
        .setAutocomplete(true);

const commands = [
    new SlashCommandBuilder()
        .setName("roblox-open")
        .setDescription("Open Roblox and join Bee Swarm")
        .addStringOption(targetRequired),

    new SlashCommandBuilder()
        .setName("roblox-close")
        .setDescription("Close Roblox on the selected emulator")
        .addStringOption(targetRequired),

    new SlashCommandBuilder()
        .setName("receive-key")
        .setDescription("Tap Receive Key then go back to Roblox")
        .addStringOption(targetRequired),

    new SlashCommandBuilder()
        .setName("enter-key")
        .setDescription("Enter the key in the box and press Continue")
        .addStringOption(targetRequired)
        .addStringOption((o) =>
            o.setName("key").setDescription("Paste the key you received").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("minimize-instances")
        .setDescription("Minimize emulator instances (Windows)"),

    new SlashCommandBuilder()
        .setName("device")
        .setDescription("Device utilities")
        .addSubcommand((sc) =>
            sc.setName("list").setDescription("List ADB devices currently detected")
        )
        .addSubcommand((sc) =>
            sc
                .setName("coords-show")
                .setDescription("Show coords for a device (or default)")
                .addStringOption(targetRequired)
        )
        .addSubcommand((sc) =>
            sc
                .setName("coords-clear")
                .setDescription("Clear custom coords override for this device (fallback to default)")
                .addStringOption(targetRequired)
        )
        .addSubcommand((sc) =>
            sc
                .setName("coords-default")
                .setDescription("Set DEFAULT coords used for any device without overrides")
                .addIntegerOption((o) => o.setName("receive_x").setDescription("Receive Key X").setRequired(true))
                .addIntegerOption((o) => o.setName("receive_y").setDescription("Receive Key Y").setRequired(true))
                .addIntegerOption((o) => o.setName("key_x").setDescription("Key box X").setRequired(true))
                .addIntegerOption((o) => o.setName("key_y").setDescription("Key box Y").setRequired(true))
                .addIntegerOption((o) => o.setName("cont_x").setDescription("Continue X").setRequired(true))
                .addIntegerOption((o) => o.setName("cont_y").setDescription("Continue Y").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("coords-set")
                .setDescription("Set coords override for a specific device serial")
                .addStringOption(targetRequired)
                .addIntegerOption((o) => o.setName("receive_x").setDescription("Receive Key X").setRequired(true))
                .addIntegerOption((o) => o.setName("receive_y").setDescription("Receive Key Y").setRequired(true))
                .addIntegerOption((o) => o.setName("key_x").setDescription("Key box X").setRequired(true))
                .addIntegerOption((o) => o.setName("key_y").setDescription("Key box Y").setRequired(true))
                .addIntegerOption((o) => o.setName("cont_x").setDescription("Continue X").setRequired(true))
                .addIntegerOption((o) => o.setName("cont_y").setDescription("Continue Y").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("minimize-set")
                .setDescription("Set Windows process names to minimize (comma-separated)")
                .addStringOption((o) =>
                    o.setName("names").setDescription("Example: MuMuNxDevice,MuMuVMMHeadless").setRequired(true)
                )
        )
        .addSubcommand((sc) =>
            sc.setName("minimize-show").setDescription("Show current minimize process names")
        ),

    new SlashCommandBuilder()
        .setName("farm")
        .setDescription("Configure and monitor Roblox farming")
        .addSubcommand((sc) =>
            sc
                .setName("add")
                .setDescription("Add a Roblox username to monitor")
                .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
                .addStringOption(targetOptional)
        )
        .addSubcommand((sc) =>
            sc
                .setName("remove")
                .setDescription("Remove a monitored username")
                .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
        )
        .addSubcommand((sc) => sc.setName("list").setDescription("List monitored usernames"))
        .addSubcommand((sc) =>
            sc
                .setName("set-place")
                .setDescription("Set Bee Swarm placeId considered 'farming'")
                .addIntegerOption((o) => o.setName("place_id").setDescription("Roblox placeId").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-webhook")
                .setDescription("Set Discord webhook URL for alerts")
                .addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true))
        )
        .addSubcommand((sc) => sc.setName("clear-webhook").setDescription("Clear webhook URL"))
        .addSubcommand((sc) => sc.setName("test-webhook").setDescription("Send a test webhook message"))
        .addSubcommand((sc) =>
            sc
                .setName("set-poll")
                .setDescription("Set poll interval (seconds)")
                .addIntegerOption((o) => o.setName("seconds").setDescription("Seconds").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-fails")
                .setDescription("Consecutive non-farming polls before alerting")
                .addIntegerOption((o) => o.setName("count").setDescription("Count").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-cooldown")
                .setDescription("Minimum seconds between alerts per user")
                .addIntegerOption((o) => o.setName("seconds").setDescription("Seconds").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-strict")
                .setDescription("Strict mode: require matching placeId (can cause false negatives)")
                .addBooleanOption((o) => o.setName("enabled").setDescription("true/false").setRequired(true))
        )
        .addSubcommand((sc) =>
            sc
                .setName("set-cookie")
                .setDescription("Set Roblox .ROBLOSECURITY cookie for API auth")
                .addStringOption((o) => o.setName("cookie").setDescription("The cookie value").setRequired(true))
        )
        .addSubcommand((sc) => sc.setName("clear-cookie").setDescription("Clear Roblox cookie"))
        .addSubcommand((sc) =>
            sc
                .setName("set-autorestart")
                .setDescription("Enable auto-restart of Roblox on device when not farming detected")
                .addBooleanOption((o) => o.setName("enabled").setDescription("true/false").setRequired(true))
        )
        .addSubcommand((sc) => sc.setName("start").setDescription("Start monitoring"))
        .addSubcommand((sc) => sc.setName("stop").setDescription("Stop monitoring"))
        .addSubcommand((sc) => sc.setName("status").setDescription("Show monitor status")),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
);

console.log("✅ Registered slash commands.");