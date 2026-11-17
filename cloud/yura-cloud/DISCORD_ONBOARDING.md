# YURA Discord onboarding (Cloud)
Opt-in: existing Zira and Discord roles are untouched until setup is completed.
The existing YURA bot token is reused. The Discord application owner must set the Interactions Endpoint URL to the Worker /discord/interactions endpoint after saving configuration.
Authenticated admin API: /api/admin/discord-onboarding (existing Bearer ADMIN_KEY or validated broadcaster Twitch OAuth).
PUT JSON {guild,welcome,staff,boomer,fc} (Discord snowflake IDs); validates appropriate guild resources and fetches the application's public verification key. Do not use privileged roles. Staff channel must be private and only admins can approve FC.
POST publishes/updates the welcome panel; GET returns config and registered profiles (no verification codes). Use separate channels for rules and FC review. Keep Zira active until tested, then remove its reaction-role rule.
Members accept the rules on modal submission and receive Boomer. Nicknames are self-declared display names (1–32 characters), without Twitch verification or strict name syntax. FC is approved by an administrator (existing FC role is accepted). For both communities: matching names (ignoring case, spaces, underscores and hyphens) appear once; distinct names use FFXIV (Twitch) if <=32 characters, otherwise FFXIV. Declared names do not confer verified Twitch IDs or subscriber roles. No existing roles are removed by onboarding.

PATCH JSON {discord_id, action: "approve_fc" | "revoke_fc"} lets the authenticated operator manage FC membership. A member cannot recover a manually removed FC role through the registration status button.
