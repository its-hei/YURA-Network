# YURA Discord onboarding (Cloud)
Opt-in: existing Zira and Discord roles are untouched until setup is completed.
The existing YURA bot token is reused. The Discord application owner must set the Interactions Endpoint URL to the Worker /discord/interactions endpoint after saving configuration.
Authenticated admin API: /api/admin/discord-onboarding (existing Bearer ADMIN_KEY).
PUT JSON {guild,welcome,staff,boomer,fc} (Discord snowflake IDs); validates appropriate guild resources and fetches the application's public verification key. Do not use privileged roles. Staff channel must be private and only admins can approve FC.
POST publishes/updates the welcome panel; GET returns config and registered profiles (no verification codes). Use separate channels for rules and FC review. Keep Zira active until tested, then remove its reaction-role rule.
Members accept the rules on modal submission and receive Boomer. Twitch nickname is only changed after !dcverify on the channel from the selected Twitch account. FC is approved by an administrator (existing FC role is accepted). Both: FFXIV (Twitch) if <=32 characters, otherwise FFXIV. No existing roles are removed by onboarding; subscriber sync integration is separate. No codes are logged by the normal chat path.
