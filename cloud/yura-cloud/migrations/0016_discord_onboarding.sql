CREATE TABLE IF NOT EXISTS discord_onboarding_profiles (
 guild_id TEXT NOT NULL, discord_id TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('ttv','fc','both')),
 twitch_login TEXT NOT NULL DEFAULT '', twitch_id TEXT, ffxiv_name TEXT NOT NULL DEFAULT '',
 fc_state TEXT NOT NULL CHECK(fc_state IN ('none','pending','approved','rejected')),
 verify_code TEXT, verify_until INTEGER NOT NULL DEFAULT 0, review_message TEXT,
 PRIMARY KEY(guild_id,discord_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS discord_onboarding_verified_twitch_id ON discord_onboarding_profiles(guild_id,twitch_id) WHERE twitch_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS discord_onboarding_verified_twitch_login ON discord_onboarding_profiles(guild_id,twitch_login) WHERE twitch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS discord_onboarding_verify_code ON discord_onboarding_profiles(guild_id,verify_code);
