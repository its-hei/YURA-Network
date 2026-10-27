interface Env {
  DB: D1Database;
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  TWITCH_BROADCASTER_ID: string;
  TWITCH_BOT_USER_ID: string;
  TWITCH_BOT_ACCESS_TOKEN: string;
  TWITCH_BOT_REFRESH_TOKEN: string;
  TWITCH_BROADCASTER_ACCESS_TOKEN: string;
  TWITCH_BROADCASTER_REFRESH_TOKEN: string;
  EVENTSUB_SECRET: string;
  ADMIN_KEY: string;
  DISCORD_BOT_TOKEN?: string;
  CLOUD_PUBLIC_URL?: string;
  POINTS_BASE_PER_10M?: string;
  POINTS_T1_PER_10M?: string;
  POINTS_T2_PER_10M?: string;
  POINTS_T3_PER_10M?: string;
  POINTS_VIP_BONUS_PER_10M?: string;
  POINTS_MOD_BONUS_PER_10M?: string;
  POINTS_ARTIST_BONUS_PER_10M?: string;
  POINTS_CHAT_MESSAGE?: string;
  EXP_PER_MESSAGE?: string;
  EXP_FIRST_MESSAGE_BONUS?: string;
  EXP_PER_LEVEL?: string;
  GAMBLE_COOLDOWN_SECONDS?: string;
}

type TwitchChatEvent = {
  broadcaster_user_id: string;
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message_id?: string;
  message: { text: string };
  badges?: Array<{ set_id: string; id: string }>;
};

type Account = {
  twitch_user_id: string;
  login: string;
  display_name: string;
  points: number;
  watch_seconds: number;
  exp: number;
  exp_stream: number;
  exp_stream_key: string;
  last_level_up_utc: string;
  last_write_utc: string;
};

const PRESENCE_INTERVAL_MINUTES = 10;
const PRESENCE_SAMPLE_MAX_GAP_SECONDS = 180;

type PendingPresenceUser = {
  user_id: string;
  display_name: string;
  seconds: number;
  last_seen_utc: string;
};

type PendingPresenceState = {
  last_sample_utc: string;
  present_count: number;
  users: Record<string, PendingPresenceUser>;
};

const enc = new TextEncoder();
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  }
});
const nowIso = () => new Date().toISOString();
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const norm = (v: string) => v.trim().replace(/^@/, "").toLowerCase();

async function setMeta(env: Env, key: string, value: string) {
  await env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(key, value).run();
}

async function cloudFlag(env: Env, key: string, fallback = false) {
  // Final Minimal Cloud profile: these modules are Desktop-local even if an older D1
  // installation still contains stale "1" flags. Return before touching D1 so chat
  // messages do not spend reads on disabled history/timer/death/runtime features.
  if (key === "cloud_timers_enabled" ||
      key === "cloud_deaths_enabled" ||
      key === "cloud_stream_events_enabled" ||
      key === "cloud_history_enabled") return false;

  const row = await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  const raw = String(row?.value ?? "").trim();
  if (!raw) return fallback;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

// Single source for the Cloud chat/leaderboard bot blacklist.
const RANKING_BOT_LOGINS = [
  "yuranetwork", "yuranetworkttv", "streamelements", "nightbot", "sery_bot",
  "serybot", "streamlabs", "moobot", "fossabot", "creatisbot", "botrix"
] as const;

function knownBotLogin(login: string) {
  const x = norm(login);
  return RANKING_BOT_LOGINS.some(name => name === x) || x.includes("botrix");
}

async function logCloudEvent(env: Env, eventType: string, userLogin = "", displayName = "", detail = "", amount = 0) {
  if (!await cloudFlag(env, "cloud_history_enabled", false)) return;
  await env.DB.prepare(`INSERT INTO cloud_events(event_type,user_login,display_name,detail,amount,created_at_utc)
    VALUES(?1,?2,?3,?4,?5,?6)`)
    .bind(String(eventType||"").toUpperCase().slice(0,40), norm(userLogin||""), String(displayName||"").slice(0,120), String(detail||"").slice(0,1000), Math.trunc(Number(amount)||0), nowIso()).run();
}

async function cloudStatus(env: Env) {
  const rows = await env.DB.prepare(`SELECT key,value FROM meta WHERE key IN ('stream_live','stream_started_at_utc','last_presence_sample_utc','presence_count','last_points_awarded','last_watch_added_seconds','presence_pending_json','eventsub_chat_status','eventsub_last_check_utc','eventsub_last_error','eventsub_last_chat_utc')`).all<{key:string,value:string}>();
  const meta = new Map<string, string>((rows.results ?? []).map(x => [String(x.key), String(x.value ?? "")] as [string, string]));
  const live = meta.get("stream_live") === "1";
  let pendingPresence: PendingPresenceState | null = null;
  try {
    const parsed:any = JSON.parse(meta.get("presence_pending_json") || "null");
    if (parsed && typeof parsed === "object") pendingPresence = parsed as PendingPresenceState;
  } catch {}
  return {
    ok: true, service: "YURA Cloud", version: "3.2.8", regular_commands_ready: true,
    stream_live: live, stream_started_at_utc: meta.get("stream_started_at_utc") || null,
    last_presence_sample_utc: pendingPresence?.last_sample_utc || meta.get("last_presence_sample_utc") || null,
    present_count: Math.max(0, Number(pendingPresence?.present_count ?? meta.get("presence_count") ?? 0) || 0),
    last_points_awarded: Math.max(0, Number(meta.get("last_points_awarded") ?? 0) || 0),
    last_watch_added_seconds: Math.max(0, Number(meta.get("last_watch_added_seconds") ?? 0) || 0),
    presence_interval_minutes: PRESENCE_INTERVAL_MINUTES,
    eventsub_chat_status: meta.get("eventsub_chat_status") || "unknown",
    eventsub_last_check_utc: meta.get("eventsub_last_check_utc") || null,
    eventsub_last_error: meta.get("eventsub_last_error") || null,
    eventsub_last_chat_utc: meta.get("eventsub_last_chat_utc") || null,
    discord_leave_status: "local",
    discord_leave_last_check_utc: null,
    discord_leave_last_error: null,
    discord_leave_last_user: null,
    community_watch_status: "manual",
    community_watch_last_check_utc: null,
    community_watch_last_error: null,
    community_followers_total: 0,
    community_subscribers_total: 0,
    community_subscribers_ready: false,
    community_subscribers: [],
    cloud_timers_enabled: false,
    cloud_deaths_enabled: false,
    cloud_stream_events_enabled: false,
    cloud_history_enabled: false,
    cloud_timers_status: "local",
    cloud_timers_last_run_utc: null,
    cloud_timers_last_error: null,
    cloud_timers_active: 0,
    death_state_ready: false,
    death_active_counter: 1,
    death_counts: [0,0,0],
    cloud_stream_last_event_utc: null
  };
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map(x => x.toString(16).padStart(2, "0")).join("");
}

async function verifyEventSub(req: Request, env: Env, body: string): Promise<boolean> {
  const id = req.headers.get("Twitch-Eventsub-Message-Id") ?? "";
  const ts = req.headers.get("Twitch-Eventsub-Message-Timestamp") ?? "";
  const actual = req.headers.get("Twitch-Eventsub-Message-Signature") ?? "";
  if (!id || !ts || !actual || !env.EVENTSUB_SECRET) return false;
  const expected = "sha256=" + await hmacHex(env.EVENTSUB_SECRET, id + ts + body);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}


let cachedAppAccessToken = "";
let cachedAppAccessTokenExpiresAt = 0;

async function getAppAccessToken(env: Env, forceRefresh = false) {
  if (!forceRefresh && cachedAppAccessToken && cachedAppAccessTokenExpiresAt > Date.now() + 300000)
    return cachedAppAccessToken;

  const params = new URLSearchParams({ client_id: env.TWITCH_CLIENT_ID, client_secret: env.TWITCH_CLIENT_SECRET, grant_type: "client_credentials" });
  const res = await fetch("https://id.twitch.tv/oauth2/token?" + params.toString(), { method: "POST" });
  if (!res.ok) throw new Error(`Twitch app token ${res.status}: ${await res.text()}`);
  const data:any = await res.json();
  cachedAppAccessToken = String(data.access_token ?? "");
  cachedAppAccessTokenExpiresAt = Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000;
  return cachedAppAccessToken;
}

async function getEventSubSubscriptions(env: Env) {
  const appToken = await getAppAccessToken(env);
  const res = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
    headers: { "Client-Id": env.TWITCH_CLIENT_ID, "Authorization": `Bearer ${appToken}` }
  });
  if (!res.ok) throw new Error(`EventSub list ${res.status}: ${await res.text()}`);
  const data:any = await res.json();
  return Array.isArray(data?.data) ? data.data : [];
}

function desiredEventSubSpecs(env: Env, callbackBase: string) {
  const callback = callbackBase.replace(/\/$/, "") + "/eventsub";
  return [
    { type: "channel.chat.message", version: "1", condition: { broadcaster_user_id: env.TWITCH_BROADCASTER_ID, user_id: env.TWITCH_BOT_USER_ID }, callback },
    { type: "stream.online", version: "1", condition: { broadcaster_user_id: env.TWITCH_BROADCASTER_ID }, callback },
    { type: "stream.offline", version: "1", condition: { broadcaster_user_id: env.TWITCH_BROADCASTER_ID }, callback }
  ];
}

function sameEventSubCondition(type: string, actual: any, expected: any) {
  if (String(actual?.broadcaster_user_id ?? "") !== String(expected?.broadcaster_user_id ?? "")) return false;
  if (type === "channel.chat.message")
    return String(actual?.user_id ?? "") === String(expected?.user_id ?? "");
  return true;
}

async function ensureEventSub(env: Env, callbackBase: string) {
  const appToken = await getAppAccessToken(env);
  const existing = await getEventSubSubscriptions(env);
  const specs = desiredEventSubSpecs(env, callbackBase);
  const results:any[] = [];

  for (const spec of specs) {
    const matches = existing.filter((x:any) =>
      x?.type === spec.type &&
      sameEventSubCondition(spec.type, x?.condition, spec.condition) &&
      String(x?.transport?.method ?? "") === "webhook" &&
      String(x?.transport?.callback ?? "").replace(/\/$/, "") === spec.callback.replace(/\/$/, "")
    );
    const enabled = matches.find((x:any) => x?.status === "enabled");
    if (enabled) {
      results.push({ type: spec.type, ok: true, status: 200, subscription_status: "enabled", id: enabled.id, reused: true });
      continue;
    }
    const pending = matches.find((x:any) => x?.status === "webhook_callback_verification_pending");
    if (pending) {
      results.push({ type: spec.type, ok: true, status: 200, subscription_status: "webhook_callback_verification_pending", id: pending.id, reused: true });
      continue;
    }

    const res = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: { "Client-Id": env.TWITCH_CLIENT_ID, "Authorization": `Bearer ${appToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: spec.type,
        version: spec.version,
        condition: spec.condition,
        transport: { method: "webhook", callback: spec.callback, secret: env.EVENTSUB_SECRET }
      })
    });
    const text = await res.text();
    let parsed:any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { }
    const sub = Array.isArray(parsed?.data) ? parsed.data[0] : null;
    results.push({
      type: spec.type,
      status: res.status,
      ok: res.status === 202,
      subscription_status: sub?.status ?? null,
      id: sub?.id ?? null,
      response: res.status === 202 ? undefined : text
    });
  }

  const chat = results.find(x => x.type === "channel.chat.message");
  const chatHealthy = Boolean(chat?.ok) && ["enabled", "webhook_callback_verification_pending"].includes(String(chat?.subscription_status ?? ""));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_chat_status',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(chatHealthy ? String(chat.subscription_status) : `error:${chat?.status ?? 0}`),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_last_check_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowIso()),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(chatHealthy ? "" : String(chat?.response ?? "channel.chat.message subscription unavailable").slice(0, 1000))
  ]);
  return { ok: chatHealthy, results };
}

async function refreshUserToken(env: Env, kind: "bot" | "broadcaster", refreshToken: string) {
  let clientId = env.TWITCH_CLIENT_ID;
  let clientSecret = env.TWITCH_CLIENT_SECRET;
  if (kind === "broadcaster") {
    const syncedClientId = (await getMetaValue(env, "oauth_broadcaster_client_id")).trim();
    if (syncedClientId) {
      clientId = syncedClientId;
      // Desktop Public / Device Code grants refresh without a client secret.
      if (clientId !== env.TWITCH_CLIENT_ID) clientSecret = "";
    }
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  const res = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", body });
  if (!res.ok) throw new Error(`Twitch token refresh ${kind} ${res.status}: ${await res.text()}`);
  const data:any = await res.json();
  const expiresAt = new Date(Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO oauth_tokens(kind,access_token,refresh_token,expires_at_utc,updated_at_utc) VALUES(?1,?2,?3,?4,?5)
    ON CONFLICT(kind) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at_utc=excluded.expires_at_utc,updated_at_utc=excluded.updated_at_utc`)
    .bind(kind, String(data.access_token ?? ""), String(data.refresh_token ?? refreshToken), expiresAt, nowIso()).run();
  return String(data.access_token ?? "");
}

async function getUserToken(env: Env, kind: "bot" | "broadcaster") {
  const row = await env.DB.prepare("SELECT access_token,refresh_token,expires_at_utc FROM oauth_tokens WHERE kind=?1").bind(kind).first<any>();
  const envAccess = kind === "bot" ? env.TWITCH_BOT_ACCESS_TOKEN : env.TWITCH_BROADCASTER_ACCESS_TOKEN;
  const envRefresh = kind === "bot" ? env.TWITCH_BOT_REFRESH_TOKEN : env.TWITCH_BROADCASTER_REFRESH_TOKEN;
  const access = String(row?.access_token || envAccess || "");
  const refresh = String(row?.refresh_token || envRefresh || "");
  const expires = row?.expires_at_utc ? Date.parse(String(row.expires_at_utc)) : 0;
  if (!access && refresh) return refreshUserToken(env, kind, refresh);
  if (expires && expires <= Date.now() + 30000 && refresh) return refreshUserToken(env, kind, refresh);
  return access;
}

async function twitchApi(env: Env, url: string, init: RequestInit = {}, kind: "bot" | "broadcaster" = "bot"): Promise<Response> {
  let token = await getUserToken(env, kind);
  const requestClientId = kind === "broadcaster"
    ? ((await getMetaValue(env, "oauth_broadcaster_client_id")).trim() || env.TWITCH_CLIENT_ID)
    : env.TWITCH_CLIENT_ID;
  const make = async (tok: string) => {
    const headers = new Headers(init.headers);
    headers.set("Client-Id", requestClientId);
    headers.set("Authorization", `Bearer ${tok}`);
    headers.set("Content-Type", "application/json");
    return fetch(url, { ...init, headers });
  };
  let res = await make(token);
  if (res.status === 401) {
    const row = await env.DB.prepare("SELECT refresh_token FROM oauth_tokens WHERE kind=?1").bind(kind).first<any>();
    const refresh = String(row?.refresh_token || (kind === "bot" ? env.TWITCH_BOT_REFRESH_TOKEN : env.TWITCH_BROADCASTER_REFRESH_TOKEN) || "");
    if (refresh) {
      token = await refreshUserToken(env, kind, refresh);
      res = await make(token);
    }
  }
  return res;
}

async function sendChat(env: Env, message: string, replyParentMessageId?: string) {
  // Use an App Access Token for the actual send. The durable bot/broadcaster grants
  // authorize the app; App Access is what makes Twitch render the official Chat Bot badge.
  const payload: Record<string, string> = {
    broadcaster_id: env.TWITCH_BROADCASTER_ID,
    sender_id: env.TWITCH_BOT_USER_ID,
    message: message.slice(0, 500)
  };
  if (replyParentMessageId) payload.reply_parent_message_id = replyParentMessageId;

  const make = async (token: string) => fetch("https://api.twitch.tv/helix/chat/messages", {
    method: "POST",
    headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  let appToken = await getAppAccessToken(env);
  let res = await make(appToken);
  if (res.status === 401) {
    appToken = await getAppAccessToken(env, true);
    res = await make(appToken);
  }
  if (!res.ok) throw new Error(`Twitch chat send ${res.status}: ${await res.text()}`);
}

async function ensureAccount(env: Env, userId: string, loginRaw: string, displayRaw: string) {
  const login = norm(loginRaw);
  const display = displayRaw.trim() || login;
  const now = nowIso();
  await env.DB.prepare(`
    INSERT INTO accounts(login,twitch_user_id,display_name,created_at_utc,last_write_utc)
    VALUES(?1,?2,?3,?4,?4)
    ON CONFLICT(login) DO UPDATE SET
      twitch_user_id=CASE WHEN excluded.twitch_user_id<>'' THEN excluded.twitch_user_id ELSE accounts.twitch_user_id END,
      display_name=excluded.display_name,
      last_write_utc=excluded.last_write_utc
  `).bind(login, userId ?? "", display, now).run();
}

async function addPoints(env: Env, userId: string, loginRaw: string, displayRaw: string, delta: number, reason: string, source: string) {
  const login = norm(loginRaw);
  await ensureAccount(env, userId, login, displayRaw);
  const row = await env.DB.prepare("SELECT points, display_name FROM accounts WHERE login=?1 LIMIT 1").bind(login).first<{points:number,display_name:string}>();
  const before = Number(row?.points ?? 0);
  const after = Math.max(0, before + Math.trunc(delta));
  const actual = after - before;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE accounts SET points=?1,last_write_utc=?2 WHERE login=?3").bind(after, now, login),
    env.DB.prepare(`INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
      .bind(userId ?? "", login, displayRaw || row?.display_name || login, actual, after, reason, source, now)
  ]);
  return after;
}

async function getAccount(env: Env, loginRaw: string): Promise<Account | null> {
  const login = norm(loginRaw);
  const row = await env.DB.prepare(`SELECT twitch_user_id,login,display_name,points,(watch_seconds+watch_seed_seconds) total_watch_seconds,exp,exp_stream,exp_stream_key,last_level_up_utc,last_write_utc FROM accounts WHERE login=?1 LIMIT 1`).bind(login).first<any>();
  if (!row) return null;
  return {
    twitch_user_id: row.twitch_user_id ?? "",
    login: row.login,
    display_name: row.display_name,
    points: Number(row.points ?? 0),
    watch_seconds: Number(row.total_watch_seconds ?? 0),
    exp: Math.max(0, Number(row.exp ?? 0) || 0),
    exp_stream: Math.max(0, Number(row.exp_stream ?? 0) || 0),
    exp_stream_key: String(row.exp_stream_key ?? ""),
    last_level_up_utc: String(row.last_level_up_utc ?? ""),
    last_write_utc: row.last_write_utc ?? ""
  };
}

function formatWatch(seconds: number) {
  const totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${String(hours).padStart(2,"0")}h ${String(minutes).padStart(2,"0")}m`;
}

type CommandConfig = {
  enabled: boolean;
  alwaysOnline: boolean;
  streamOn: boolean;
  aliases: string;
  permission: "EVERYONE" | "VIP" | "MOD_BROADCASTER" | "BROADCASTER";
  userCooldown: number;
  globalCooldown: number;
  winPercent?: number;
  critWinPercent?: number;
  defaultDurationSeconds?: number;
  joinConfirmation?: boolean;
  warning20Seconds?: boolean;
  warningFinalThird?: boolean;
};

type CommandSettings = Record<string, CommandConfig>;

type CustomCommandConfig = {
  id: string;
  enabled: boolean;
  aliases: string;
  message: string;
  userCooldown: number;
  globalCooldown: number;
  permission: "EVERYONE" | "VIP" | "MOD_BROADCASTER" | "BROADCASTER";
  alwaysOnline: boolean;
  streamOn: boolean;
  onlyWhenLive: boolean;
};

function defaultCommandSettings(env: Env): CommandSettings {
  return {
    points: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!points,!pkt,!yura", permission:"EVERYONE", userCooldown:0, globalCooldown:0 },
    gamble: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!gamble", permission:"EVERYONE", userCooldown:num(env.GAMBLE_COOLDOWN_SECONDS,30), globalCooldown:0, winPercent:50, critWinPercent:1 },
    pokemon: { enabled:true, alwaysOnline:true, streamOn:true, aliases:"!pokemon", permission:"EVERYONE", userCooldown:3, globalCooldown:0 },
    pokeroll: { enabled:true, alwaysOnline:true, streamOn:true, aliases:"!pokeroll", permission:"EVERYONE", userCooldown:5, globalCooldown:0 },
    top: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!top,!toppoints", permission:"EVERYONE", userCooldown:0, globalCooldown:0 },
    accountage: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!accountage", permission:"EVERYONE", userCooldown:15, globalCooldown:5 },
    followage: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!followage", permission:"EVERYONE", userCooldown:15, globalCooldown:5 },
    uptime: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!uptime", permission:"EVERYONE", userCooldown:15, globalCooldown:5 },
    watchtime: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!watchtime,!czas", permission:"EVERYONE", userCooldown:15, globalCooldown:5 },
    add: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!add,!addpoints,!addpkt", permission:"MOD_BROADCASTER", userCooldown:0, globalCooldown:0 },
    remove: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!remove,!removepoints,!removepkt", permission:"MOD_BROADCASTER", userCooldown:0, globalCooldown:0 },
    deaths: { enabled:true, alwaysOnline:true, streamOn:true, aliases:"!dedge,!deska", permission:"EVERYONE", userCooldown:0, globalCooldown:0 },
    deathsAmount: { enabled:false, alwaysOnline:false, streamOn:false, aliases:"!dedges,!deski", permission:"EVERYONE", userCooldown:0, globalCooldown:0 },
    raffle: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!raffle", permission:"MOD_BROADCASTER", userCooldown:1, globalCooldown:1, defaultDurationSeconds:60, joinConfirmation:true, warning20Seconds:true },
    sraffle: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!sraffle", permission:"MOD_BROADCASTER", userCooldown:1, globalCooldown:1, defaultDurationSeconds:60, joinConfirmation:true, warning20Seconds:true },
    autoraffle: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!autoraffle", permission:"MOD_BROADCASTER", userCooldown:1, globalCooldown:1 },
    jackpot: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!jackpot", permission:"EVERYONE", userCooldown:1, globalCooldown:1, defaultDurationSeconds:60 },
    alertcontrol: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!alert", permission:"MOD_BROADCASTER", userCooldown:1, globalCooldown:0 },
    cancelraffle: { enabled:true, alwaysOnline:false, streamOn:true, aliases:"!cancelraffle,!rafflecancel", permission:"MOD_BROADCASTER", userCooldown:1, globalCooldown:1 }
  };
}

function normalizePermission(value: unknown, fallback: CommandConfig["permission"]): CommandConfig["permission"] {
  const v = String(value ?? "").trim().toUpperCase();
  return v === "EVERYONE" || v === "VIP" || v === "MOD_BROADCASTER" || v === "BROADCASTER" ? v : fallback;
}

function normalizeAliases(value: unknown, fallback: string): string {
  const raw = String(value ?? fallback);
  // UI accepts aliases separated by spaces, commas, semicolons or new lines.
  // Canonicalize all of them here so OWN and built-in commands behave identically.
  const out = raw.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean).map(x => x.startsWith("!") ? x : "!"+x);
  return [...new Set(out)].join(",") || fallback;
}

async function loadCommandSettings(env: Env): Promise<CommandSettings> {
  const defaults = defaultCommandSettings(env);
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key='command_settings_json' LIMIT 1").first<{value:string}>();
  if (!row?.value) return defaults;
  try {
    const raw:any = JSON.parse(row.value);
    for (const key of Object.keys(defaults)) {
      const src = raw?.[key];
      if (!src || typeof src !== "object") continue;
      const base = defaults[key];
      const normalized: CommandConfig = {
        enabled: typeof src.enabled === "boolean" ? src.enabled : base.enabled,
        alwaysOnline: typeof src.alwaysOnline === "boolean" ? src.alwaysOnline : base.alwaysOnline,
        streamOn: typeof src.streamOn === "boolean" ? src.streamOn : base.streamOn,
        aliases: normalizeAliases(src.aliases, base.aliases),
        permission: normalizePermission(src.permission, base.permission),
        userCooldown: Math.max(0, Math.min(3600, Math.trunc(Number(src.userCooldown ?? base.userCooldown) || 0))),
        globalCooldown: Math.max(0, Math.min(3600, Math.trunc(Number(src.globalCooldown ?? base.globalCooldown) || 0)))
      };
      if (key === "gamble") {
        normalized.winPercent = Math.max(0, Math.min(100, Number(src.winPercent ?? base.winPercent ?? 50) || 0));
        normalized.critWinPercent = Math.max(0, Math.min(100 - normalized.winPercent, Number(src.critWinPercent ?? base.critWinPercent ?? 1) || 0));
      }
      if (key === "raffle" || key === "sraffle" || key === "jackpot") {
        normalized.defaultDurationSeconds = Math.max(5, Math.min(3600, Math.trunc(Number(src.defaultDurationSeconds ?? base.defaultDurationSeconds ?? 60) || 60)));
        normalized.joinConfirmation = typeof src.joinConfirmation === "boolean" ? src.joinConfirmation : (base.joinConfirmation ?? true);
        normalized.warning20Seconds = typeof src.warning20Seconds === "boolean" ? src.warning20Seconds : (base.warning20Seconds ?? true);
      }
      defaults[key] = normalized;
    }
  } catch {}
  return defaults;
}

async function loadCustomCommands(env: Env): Promise<CustomCommandConfig[]> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key='command_settings_json' LIMIT 1").first<{value:string}>();
  if (!row?.value) return [];
  try {
    const raw:any = JSON.parse(row.value);
    if (!Array.isArray(raw?.customCommands)) return [];
    return raw.customCommands.slice(0,100).map((src:any, index:number) => ({
      id: String(src?.id ?? `custom-${index}`).slice(0,80),
      enabled: typeof src?.enabled === "boolean" ? src.enabled : true,
      aliases: normalizeAliases(src?.aliases, ""),
      message: String(src?.message ?? "").slice(0,500),
      userCooldown: Math.max(0, Math.min(3600, Math.trunc(Number(src?.userCooldown ?? 0) || 0))),
      globalCooldown: Math.max(0, Math.min(3600, Math.trunc(Number(src?.globalCooldown ?? 0) || 0))),
      permission: normalizePermission(src?.permission, "EVERYONE"),
      alwaysOnline: typeof src?.alwaysOnline === "boolean" ? src.alwaysOnline : true,
      streamOn: typeof src?.streamOn === "boolean" ? src.streamOn : true,
      onlyWhenLive: typeof src?.onlyWhenLive === "boolean" ? src.onlyWhenLive : false
    })).filter((x:CustomCommandConfig) => x.aliases && x.message);
  } catch { return []; }
}

async function loadCommandMasterEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key='command_settings_json' LIMIT 1").first<{value:string}>();
  if (!row?.value) return true;
  try {
    const raw:any = JSON.parse(row.value);
    return typeof raw?.masterEnabled === "boolean" ? raw.masterEnabled : true;
  } catch { return true; }
}

function commandMatchesConfig(cmd: string, cfg: CommandConfig, _masterEnabled: boolean) {
  return cfg.enabled && cfg.aliases.split(",").map(x=>x.trim().toLowerCase()).includes(cmd);
}

function commandLevenshtein(left: string, right: string) {
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({length:right.length+1}, (_,i)=>i);
  let current = new Array<number>(right.length+1);
  for (let i=1;i<=left.length;i++) {
    current[0] = i;
    for (let j=1;j<=right.length;j++) {
      const cost = left[i-1] === right[j-1] ? 0 : 1;
      current[j] = Math.min(current[j-1]+1, previous[j]+1, previous[j-1]+cost);
    }
    [previous,current] = [current,previous];
  }
  return previous[right.length];
}

function commandUsageForSuggestion(key: string, cfg: CommandConfig) {
  const primary = cfg.aliases.split(",").map(x=>x.trim()).find(Boolean) || `!${key}`;
  if (key === "gamble") return `${primary} <kwota|procent%|all>`;
  if (key === "pokemon") return `${primary} (darmowe pierwsze losowanie / sprawdzenie)`;
  if (key === "pokeroll") return `${primary} (nowy Pokémon za 5 000 YURA)`;
  if (key === "watchtime") return `${primary} [@nick]`;
  if (key === "add") return `${primary} @nick <liczba> lub ${primary} all <liczba>`;
  if (key === "remove") return `${primary} @nick <liczba>`;
  return primary;
}

function findYuraPointsCommandSuggestion(cmd: string, settings: CommandSettings, masterEnabled = true) {
  const keys = ["points","gamble","pokemon","pokeroll","top","watchtime","add","remove"];
  if (!cmd.startsWith("!") || cmd.length < 4) return "";
  let best = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const cfg = settings[key];
    if (!cfg?.enabled) continue;
    for (const aliasRaw of cfg.aliases.split(",")) {
      const alias = aliasRaw.trim().toLowerCase();
      if (!alias) continue;
      const distance = commandLevenshtein(cmd, alias);
      const threshold = Math.max(cmd.length, alias.length) <= 6 ? 1 : 2;
      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        best = commandUsageForSuggestion(key,cfg);
      }
    }
  }
  return best;
}

function commandPermissionAllows(event: TwitchChatEvent, env: Env, permission: CommandConfig["permission"]) {
  const badges = new Set((event.badges ?? []).map(x => x.set_id));
  const broadcaster = event.chatter_user_id === env.TWITCH_BROADCASTER_ID || badges.has("broadcaster");
  const moderator = badges.has("moderator");
  const vip = badges.has("vip");
  if (permission === "BROADCASTER") return broadcaster;
  if (permission === "MOD_BROADCASTER") return broadcaster || moderator;
  if (permission === "VIP") return broadcaster || moderator || vip;
  return true;
}

async function tryEnterCloudCommandCooldown(env: Env, commandKey: string, userId: string, cfg: CommandConfig) {
  const now = Date.now();
  const checks = [
    { id:"*", seconds:cfg.globalCooldown },
    { id:userId || "unknown", seconds:cfg.userCooldown }
  ];
  for (const check of checks) {
    if (check.seconds <= 0) continue;
    const row = await env.DB.prepare("SELECT expires_at_utc FROM command_cooldowns WHERE command_key=?1 AND user_id=?2")
      .bind(commandKey, check.id).first<{expires_at_utc:string}>();
    if (row?.expires_at_utc && Date.parse(row.expires_at_utc) > now) return false;
  }
  for (const check of checks) {
    if (check.seconds <= 0) continue;
    await env.DB.prepare(`INSERT INTO command_cooldowns(command_key,user_id,expires_at_utc) VALUES(?1,?2,?3)
      ON CONFLICT(command_key,user_id) DO UPDATE SET expires_at_utc=excluded.expires_at_utc`)
      .bind(commandKey, check.id, new Date(now + check.seconds*1000).toISOString()).run();
  }
  return true;
}

// Only successful Jackpot starts consume a cooldown; invalid attempts must reply.
// v2 ignores historical jackpot cooldown rows written before input validation.
const JACKPOT_START_COOLDOWN_KEY = "jackpot-start-v2";
async function remainingJackpotCooldownSeconds(env:Env,userId:string,cfg:CommandConfig):Promise<number> {
  const now=Date.now();
  let remaining=0;
  for(const check of [{id:"*",seconds:cfg.globalCooldown},{id:userId||"unknown",seconds:cfg.userCooldown}]) {
    if(check.seconds<=0)continue;
    const row=await env.DB.prepare("SELECT expires_at_utc FROM command_cooldowns WHERE command_key=?1 AND user_id=?2")
      .bind(JACKPOT_START_COOLDOWN_KEY,check.id).first<{expires_at_utc:string}>();
    const until=Date.parse(String(row?.expires_at_utc||""));
    if(Number.isFinite(until))remaining=Math.max(remaining,Math.ceil((until-now)/1000));
  }
  return Math.max(0,remaining);
}
// Shared, atomic global cooldown/lock for all YURA prize draws.
const RAFFLE_SHARED_START_KEY="raffle-family-v1";
async function enterSharedRaffleStartGate(env:Env,durationSeconds:number,globalCooldownSeconds:number):Promise<number> {
  const now=Date.now();
  const blockMs=Math.max(15000,Math.max(5,durationSeconds)*1000,Math.max(0,globalCooldownSeconds)*1000);
  const end=new Date(now+blockMs).toISOString();
  const current=new Date(now).toISOString();
  const row=await env.DB.prepare(`INSERT INTO command_cooldowns(command_key,user_id,expires_at_utc)
    VALUES(?1,'*',?2)
    ON CONFLICT(command_key,user_id) DO UPDATE SET expires_at_utc=excluded.expires_at_utc
    WHERE command_cooldowns.expires_at_utc<=?3`).bind(RAFFLE_SHARED_START_KEY,end,current).run();
  if(Number(row.meta?.changes||0)===1)return 0;
  const existing=await env.DB.prepare(`SELECT expires_at_utc FROM command_cooldowns WHERE command_key=?1 AND user_id='*'`)
    .bind(RAFFLE_SHARED_START_KEY).first<{expires_at_utc:string}>();
  return Math.max(1,Math.ceil((Date.parse(String(existing?.expires_at_utc||""))-now)/1000)||1);
}
async function tryStartRaffleFamily(env:Env,display:string,durationSeconds:number,cfg:CommandConfig):Promise<boolean>{
  const wait=await enterSharedRaffleStartGate(env,durationSeconds,cfg.globalCooldown);
  if(wait>0){await sendChat(env,`🎟️ @${display} trwa losowanie lub wspólny cooldown Raffle/Jackpot. Spróbuj za ${wait} s.`);return false;}
  return true;
}
function formatAge(iso: string) {
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return "0 dni";
  const days = Math.max(0, Math.floor((Date.now()-started)/86400000));
  const years = Math.floor(days/365), months = Math.floor((days%365)/30), rest = (days%365)%30;
  const parts:string[] = [];
  if (years) parts.push(`${years} r.`);
  if (months) parts.push(`${months} mies.`);
  if (rest || !parts.length) parts.push(`${rest} dni`);
  return parts.join(" ");
}

function isYuraPointsBotLogin(login: string) {
  const value = norm(login);
  return value === "yuranetwork" || value === "yuranetworkttv" || value === "streamelements" ||
    value === "nightbot" || value === "sery_bot" || value === "serybot" || value === "creatisbot" || value.includes("botrix");
}

async function getCurrentChatters(env: Env) {
  const result:any[] = [];
  let cursor = "";
  do {
    let url = `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}&moderator_id=${encodeURIComponent(env.TWITCH_BOT_USER_ID)}&first=1000`;
    if (cursor) url += `&after=${encodeURIComponent(cursor)}`;
    const res = await twitchApi(env, url, {}, "bot");
    if (!res.ok) throw new Error(`Get Chatters ${res.status}: ${await res.text()}`);
    const body:any = await res.json();
    if (Array.isArray(body?.data)) result.push(...body.data);
    cursor = String(body?.pagination?.cursor ?? "");
  } while (cursor);
  const seen = new Set<string>();
  return result.filter((item:any) => {
    const login = norm(item?.user_login ?? "");
    if (!login || item?.user_id === env.TWITCH_BOT_USER_ID || isYuraPointsBotLogin(login) || seen.has(login)) return false;
    seen.add(login);
    return true;
  });
}

async function twitchUserByLogin(env: Env, login: string) {
  // Get Users accepts a normal user access token. Reuse the already-working bot
  // OAuth token instead of minting an app token, so Regular commands do not
  // depend on TWITCH_CLIENT_SECRET just to read public Twitch data.
  const res = await twitchApi(env, `https://api.twitch.tv/helix/users?login=${encodeURIComponent(norm(login))}`, {}, "bot");
  if (!res.ok) return null;
  const body:any = await res.json();
  return Array.isArray(body?.data) && body.data.length ? body.data[0] : null;
}


type YuraRaffleEntry = { userId:string; login:string; display:string };
type YuraRaffleState = { active:boolean; mode:"single"|"multi"|"auto"|"jackpot"; prize:number; id?:string; jackpotId?:number; endsAtUtc:string; durationSeconds?:number; entries:YuraRaffleEntry[]; winnerCount?:number; warningSent?:boolean; joinConfirmation?:boolean; warning20Seconds?:boolean; warningFinalThird?:boolean };

async function getYuraRaffleState(env: Env): Promise<YuraRaffleState | null> {
  const raw = await getMetaValue(env,"yura_raffle_state_json");
  if (!raw) return null;
  try { return JSON.parse(raw) as YuraRaffleState; } catch { return null; }
}

async function setYuraRaffleState(env: Env, state: YuraRaffleState | null) {
  await setMeta(env,"yura_raffle_state_json", state ? JSON.stringify(state) : "");
}

function yuraRaffleWinnerCount(mode:"single"|"multi", count:number) {
  if (mode === "single") return count > 0 ? 1 : 0;
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 10) return Math.floor(count/2);
  if (count <= 20) return Math.max(1,Math.floor(count/4));
  if (count <= 50) return Math.max(1,Math.floor(count/5));
  if (count <= 200) return Math.max(1,Math.floor(count/8));
  return Math.max(1,Math.floor(count/20));
}

function cryptoShuffle<T>(items:T[]) {
  const a=[...items];
  for (let i=a.length-1;i>0;i--) {
    const r=crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
    const j=Math.floor(r*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

// Jackpot entries use D1 triggers: one successful INSERT is one debit, even if Twitch retries !join.
// Credits/refunds are likewise recorded by UNIQUE ledger rows and their AFTER INSERT triggers.
async function jackpotEntries(env: Env, sessionId: number) {
  const rows = await env.DB.prepare("SELECT login,twitch_user_id,display_name,stake FROM jackpot_entries WHERE session_id=?1 ORDER BY joined_at_utc, login").bind(sessionId).all<any>();
  return rows.results ?? [];
}

async function finishJackpot(env: Env, sessionId: number, cancel = false) {
  const row = await env.DB.prepare("SELECT * FROM jackpot_sessions WHERE id=?1").bind(sessionId).first<any>();
  if (!row || row.status === "paid" || row.status === "refunded") return false;
  if (!cancel && row.status === "open" && Date.parse(row.ends_at_utc) > Date.now()) return false;
  const entries = await jackpotEntries(env, sessionId);
  const refund = cancel || entries.length < 2;
  if (row.status === "open") {
    await env.DB.prepare("UPDATE jackpot_sessions SET status=?1 WHERE id=?2 AND status='open'")
      .bind(refund ? "refunding" : "settling",sessionId).run();
  }
  const current = await env.DB.prepare("SELECT status FROM jackpot_sessions WHERE id=?1").bind(sessionId).first<{status:string}>();
  if (current?.status === "refunding") {
    for (const entry of entries) {
      await env.DB.prepare(`INSERT OR IGNORE INTO jackpot_refunds(session_id,login,twitch_user_id,display_name,amount,created_at_utc)
        VALUES(?1,?2,?3,?4,?5,?6)`).bind(sessionId,entry.login,entry.twitch_user_id,entry.display_name,entry.stake,nowIso()).run();
    }
    const count = await env.DB.prepare("SELECT COUNT(*) n FROM jackpot_refunds WHERE session_id=?1").bind(sessionId).first<{n:number}>();
    if (Number(count?.n) !== entries.length) return false;
    const done = await env.DB.prepare("UPDATE jackpot_sessions SET status='refunded' WHERE id=?1 AND status='refunding'").bind(sessionId).run();
    if ((done.meta?.changes ?? 0) !== 1) return false;
    await sendChat(env, cancel ? `🎰 Jackpot anulowany • wpisowe zwrócone ${entries.length} osobom.`
      : `🎰 Jackpot anulowany • mniej niż 2 uczestników • wpisowe zwrócone.`);
    return true;
  }
  if (current?.status !== "settling" || entries.length < 2) return false;
  const existing = await env.DB.prepare("SELECT login,display_name,amount FROM jackpot_payouts WHERE session_id=?1").bind(sessionId).first<any>();
  if (!existing) {
    const winner = cryptoShuffle(entries)[0];
    const pool = entries.reduce((sum:number,x:any) => sum + Number(x.stake),0);
    await env.DB.prepare(`INSERT OR IGNORE INTO jackpot_payouts(session_id,login,twitch_user_id,display_name,amount,created_at_utc)
      VALUES(?1,?2,?3,?4,?5,?6)`).bind(sessionId,winner.login,winner.twitch_user_id,winner.display_name,pool,nowIso()).run();
  }
  const paid = await env.DB.prepare("SELECT login,display_name,amount FROM jackpot_payouts WHERE session_id=?1").bind(sessionId).first<any>();
  if (!paid) return false;
  const done = await env.DB.prepare("UPDATE jackpot_sessions SET status='paid' WHERE id=?1 AND status='settling'").bind(sessionId).run();
  if ((done.meta?.changes ?? 0) !== 1) return false;
  await sendChat(env,`🎰 JACKPOT • @${paid.display_name} zgarnia ${Number(paid.amount).toLocaleString('pl-PL')} YURA! • ${entries.length} uczestników.`);
  return true;
}

// Crash recovery: escrow cannot be stranded if the active meta row was lost.
async function recoverJackpots(env: Env) {
  const sessions = await env.DB.prepare(`SELECT id FROM jackpot_sessions
    WHERE status IN ('settling','refunding') OR (status='open' AND ends_at_utc<=?1)
    ORDER BY id LIMIT 10`).bind(nowIso()).all<{id:number}>();
  for (const row of sessions.results ?? []) {
    await finishJackpot(env,Number(row.id));
  }
}

async function warnYuraRaffleIfDue(env: Env) {
  const state=await getYuraRaffleState(env);
  if (!state?.active || state.mode === "auto" || state.mode === "jackpot" || state.warningSent || state.warningFinalThird === false || state.warning20Seconds === false) return false;
  const remainingMs=Date.parse(state.endsAtUtc)-Date.now();
  const durationSeconds=Math.max(5,Math.min(3600,Math.trunc(Number(state.durationSeconds ?? 60)) || 60));
  const warningSeconds=Math.max(1,Math.ceil(durationSeconds/3));
  if (remainingMs <= 0 || remainingMs > warningSeconds*1000) return false;
  state.warningSent=true;
  await setYuraRaffleState(env,state);
  const remainingSeconds=Math.max(1,Math.ceil(remainingMs/1000));
  await sendChat(env,`🎟️ Raffle nadal otwarty • ostatnie 33% czasu (~${remainingSeconds}s) • wpisz !join • uczestników: ${state.entries.length}.`);
  return true;
}

async function finishYuraRaffleIfDue(env: Env, force=false) {
  const state=await getYuraRaffleState(env);
  if (!state?.active) return false;
  if (!force && Date.parse(state.endsAtUtc)>Date.now()) return false;
  if (state.mode === "jackpot") {
    if (state.jackpotId) {
      await finishJackpot(env,state.jackpotId);
      const row = await env.DB.prepare("SELECT status FROM jackpot_sessions WHERE id=?1").bind(state.jackpotId).first<{status:string}>();
      if (row?.status === "paid" || row?.status === "refunded") await setYuraRaffleState(env,null);
    }
    return true;
  }

  if (state.mode === "auto") {
    if (state.entries.length < 3) {
      await setYuraRaffleState(env,null);
      await sendChat(env,"🎟️ Auto-raffle: potrzeba co najmniej 3 obecnych widzów. Nie przyznano punktów.");
      return true;
    }
    const prize = Math.max(10,Math.trunc(state.prize || 1000));
    const amounts = [Math.floor(prize * 50 / 100),Math.floor(prize * 35 / 100)];
    amounts.push(prize - amounts[0] - amounts[1]);
    const id = state.id || `legacy-${state.endsAtUtc}`;
    const candidates = cryptoShuffle(state.entries);
    for (let rank=1;rank<=3;rank++) {
      let award = await env.DB.prepare("SELECT * FROM raffle_auto_awards WHERE raffle_id=?1 AND rank=?2").bind(id,rank).first<any>();
      if (award) continue;
      const awarded = await env.DB.prepare("SELECT login FROM raffle_auto_awards WHERE raffle_id=?1").bind(id).all<{login:string}>();
      const used = new Set((awarded.results ?? []).map(x=>x.login));
      for (const winner of candidates.filter(x=>!used.has(x.login))) {
        await ensureAccount(env,winner.userId,winner.login,winner.display);
        await env.DB.prepare(`INSERT OR IGNORE INTO raffle_auto_awards
          (raffle_id,rank,login,twitch_user_id,display_name,amount,created_at_utc)
          VALUES(?1,?2,?3,?4,?5,?6,?7)`)
          .bind(id,rank,winner.login,winner.userId,winner.display,amounts[rank-1],nowIso()).run();
        award = await env.DB.prepare("SELECT * FROM raffle_auto_awards WHERE raffle_id=?1 AND rank=?2").bind(id,rank).first<any>();
        if (award) break;
      }
      if (!award) return false; // retry later; no double-payment thanks to UNIQUE rank
    }
    const wins = await env.DB.prepare("SELECT rank,display_name,amount FROM raffle_auto_awards WHERE raffle_id=?1 ORDER BY rank").bind(id).all<any>();
    if ((wins.results ?? []).length !== 3) return false;
    await setYuraRaffleState(env,null);
    await sendChat(env,`🎟️ Auto-raffle • ${prize.toLocaleString('pl-PL')} YURA • ` +
      (wins.results ?? []).map((w:any)=>`${w.rank}. @${w.display_name}: ${Number(w.amount).toLocaleString('pl-PL')}`).join(' • '));
    return true;
  }
  await setYuraRaffleState(env,null);

  if (!state.entries.length) {
    await sendChat(env,"🎟️ Raffle zakończony • brak uczestników.");
    return true;
  }
  const winnerCount=yuraRaffleWinnerCount(state.mode,state.entries.length);
  const winners=cryptoShuffle(state.entries).slice(0,winnerCount);
  const each=Math.max(1,Math.floor(state.prize/Math.max(1,winners.length)));
  for (const w of winners) await addPoints(env,w.userId,w.login,w.display,each,"YURA raffle win","raffle");
  await sendChat(env,`🎟️ Raffle zakończony • ${winners.map(w=>"@"+w.display).join(", ")} • ${each.toLocaleString("pl-PL")} YURA${winners.length>1?" dla każdego":""}.`);
  return true;
}

// EventSub stream.online and the scheduled presence sampler are asynchronous. A command
// may be the first callback after the broadcast begins, while D1 still says offline.
// Only perform a Helix lookup in that stale/offline case; a confirmed LIVE is cached
// immediately so subsequent ONLINE commands do not need an extra network request.
async function isStreamLiveForOnlineCommand(env: Env): Promise<boolean> {
  if ((await getMetaValue(env, "stream_live")) === "1") return true;
  try {
    const stream = await getLiveStreamState(env);
    if (!stream.live) return false;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_live','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_started_at_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(stream.startedAt || nowIso())
    ]);
    return true;
  } catch (e) {
    // Fail closed: a failed Twitch API call must not activate ONLINE commands offline.
    console.warn("YURA ONLINE command live check failed", String(e));
    return false;
  }
}

// Pokémon assignments are Twitch-chat-only. Twitch EventSub user_id is the
// authoritative identity; the public website never writes these preferences.
const POKEROLL_PRICE = 5000;
const POKEMON_MAX_SPECIES_ID = 1025;
// Uniform public and chat display. Stored legacy species names may be lowercase.
function formatPokemonName(raw:string):string {
  return String(raw||'').trim().replace(/-/g,' ')
    .replace(/(^|\s)(\p{L})/gu,(_,space,letter:string)=>space+letter.toUpperCase());
}
function randomPokemonId(): number {
  // Rejection sampling avoids a small modulo bias.
  const range = 4294967296 - (4294967296 % POKEMON_MAX_SPECIES_ID);
  let n: number;
  do { n = crypto.getRandomValues(new Uint32Array(1))[0]; } while (n >= range);
  return (n % POKEMON_MAX_SPECIES_ID) + 1;
}
async function randomPokemon(excludeId?:number):Promise<{id:number,name:string}|null> {
  for (let attempt=0;attempt<4;attempt++) {
    const id=randomPokemonId();
    if(id===excludeId)continue;
    try {
      const res=await fetch('https://pokeapi.co/api/v2/pokemon-species/'+id+'/',{
        signal:AbortSignal.timeout(5000)
      });
      if(!res.ok)continue;
      const body:any=await res.json();
      const rawName=String(body?.name || '');
      if(Number(body?.id)===id && /^[a-z0-9-]{2,40}$/.test(rawName))
        return {id,name:formatPokemonName(rawName)};
    } catch { /* no charge/assignment if the species cannot be confirmed */ }
  }
  return null;
}
// Followers-only participation in Pokémon, verified server-side before any D1 write.
// Twitch OAuth/API errors fail closed; no assignments and no charges.
async function pokemonFollowerAccess(env:Env,event:TwitchChatEvent):Promise<'allowed'|'not-following'|'unavailable'> {
  const id=String(event.chatter_user_id||'').trim();
  if(!/^\d+$/.test(id))return 'unavailable';
  if(id===String(env.TWITCH_BROADCASTER_ID||''))return 'allowed';
  try {
    const url=new URL('https://api.twitch.tv/helix/channels/followers');
    url.searchParams.set('broadcaster_id',String(env.TWITCH_BROADCASTER_ID));
    url.searchParams.set('user_id',id);
    url.searchParams.set('first','1');
    const res=await twitchApi(env,url.toString(),{},'broadcaster');
    if(!res.ok)return 'unavailable';
    const body:any=await res.json();
    if(!Array.isArray(body?.data))return 'unavailable';
    return body.data.some((r:any)=>String(r?.user_id||'')===id)?'allowed':'not-following';
  }catch{return 'unavailable';}
}
async function assignFirstPokemonForChat(env:Env,event:TwitchChatEvent):Promise<{id:number,name:string,created:boolean}|null> {
  const id=String(event.chatter_user_id||'');
  const login=norm(event.chatter_user_login);
  if(!/^\d+$/.test(id)||!login||knownBotLogin(login))return null;
  const saved=await env.DB.prepare('SELECT pokemon_id,pokemon_name FROM pokemon_profiles WHERE twitch_user_id=?1')
    .bind(id).first<any>();
  if(saved) {
    // Any user who previously chose a Twitch avatar now switches to Pokémon on chat.
    await env.DB.prepare(`UPDATE pokemon_profiles SET avatar_mode='pokemon',updated_at_utc=?1
      WHERE twitch_user_id=?2 AND avatar_mode<>'pokemon'`).bind(nowIso(),id).run();
    return {id:Number(saved.pokemon_id),name:formatPokemonName(String(saved.pokemon_name)),created:false};
  }
  const chosen=await randomPokemon();
  if(!chosen)return null;
  const joinedAt=nowIso();
  const insert=await env.DB.prepare(`INSERT OR IGNORE INTO pokemon_profiles
    (twitch_user_id,login,avatar_mode,pokemon_id,pokemon_name,updated_at_utc)
    VALUES(?1,?2,'pokemon',?3,?4,?5)`)
    .bind(id,login,chosen.id,chosen.name,joinedAt).run();
  if(Number(insert.meta?.changes||0)===1) {
    await env.DB.prepare(`INSERT OR IGNORE INTO pokemon_first_assignments
      (twitch_user_id,login,pokemon_id,pokemon_name,joined_at_utc,estimated)
      VALUES(?1,?2,?3,?4,?5,0)`)
      .bind(id,login,chosen.id,chosen.name,joinedAt).run();
    return {...chosen,created:true};
  }
  // Concurrent first message: return whichever Pokémon was actually persisted.
  const actual=await env.DB.prepare('SELECT pokemon_id,pokemon_name FROM pokemon_profiles WHERE twitch_user_id=?1')
    .bind(id).first<any>();
  return actual?{id:Number(actual.pokemon_id),name:formatPokemonName(String(actual.pokemon_name)),created:false}:null;
}
async function rerollPokemonForChat(env:Env,event:TwitchChatEvent) {
  const id=String(event.chatter_user_id||'');
  const login=norm(event.chatter_user_login);
  const display=String(event.chatter_user_name||login);
  const messageId=String(event.message_id||'').trim();
  if(!/^\d+$/.test(id)||!login||!messageId||messageId.length>180||knownBotLogin(login))
    return {status:'invalid',balance:0,pokemon:null};
  const saved=await env.DB.prepare('SELECT pokemon_id FROM pokemon_profiles WHERE twitch_user_id=?1')
    .bind(id).first<any>();
  if(!saved)return {status:'unassigned',balance:0,pokemon:null};
  const duplicate=await env.DB.prepare('SELECT 1 FROM pokemon_rerolls WHERE event_id=?1')
    .bind(messageId).first<any>();
  if(duplicate)return {status:'duplicate',balance:0,pokemon:null};
  await ensureAccount(env,id,login,display);
  const current=await getAccount(env,login);
  if(Number(current?.points||0)<POKEROLL_PRICE)return {status:'insufficient',balance:Number(current?.points||0),pokemon:null};
  const chosen=await randomPokemon(Number(saved.pokemon_id));
  if(!chosen)return {status:'unavailable',balance:Number(current?.points||0),pokemon:null};
  const at=nowIso();
  // D1 batch is a transaction. Every write after the debit checks changes()
  // from the immediately preceding statement. A repeated Twitch message id
  // never charges again and cannot mutate the Pokémon or transaction history.
  const result=await env.DB.batch([
    env.DB.prepare(`UPDATE accounts SET points=points-?1,last_write_utc=?2
      WHERE login=?3 AND twitch_user_id=?4 AND points>=?1
        AND NOT EXISTS(SELECT 1 FROM pokemon_rerolls WHERE event_id=?5)`)
      .bind(POKEROLL_PRICE,at,login,id,messageId),
    env.DB.prepare(`INSERT INTO pokemon_rerolls
      (event_id,twitch_user_id,login,pokemon_id,pokemon_name,price,created_at_utc)
      SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE changes()=1`)
      .bind(messageId,id,login,chosen.id,chosen.name,POKEROLL_PRICE,at),
    env.DB.prepare(`INSERT INTO transactions
      (twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
      SELECT ?1,?2,?3,-?4,points,?5,'pokemon',?6
      FROM accounts WHERE login=?2 AND changes()=1`)
      .bind(id,login,display,POKEROLL_PRICE,'pokeroll '+chosen.name,at),
    env.DB.prepare(`UPDATE pokemon_profiles SET pokemon_id=?1,pokemon_name=?2,
       avatar_mode='pokemon',updated_at_utc=?3
      WHERE twitch_user_id=?4 AND changes()=1`)
      .bind(chosen.id,chosen.name,at,id)
  ]);
  const account=await getAccount(env,login);
  const debited=Number(result[0]?.meta?.changes||0)===1;
  const recorded=Number(result[1]?.meta?.changes||0)===1;
  const audited=Number(result[2]?.meta?.changes||0)===1;
  const assigned=Number(result[3]?.meta?.changes||0)===1;
  if(debited && recorded && audited && assigned)
    return {status:'changed',balance:Number(account?.points||0),pokemon:chosen};
  return {status:'duplicate',balance:Number(account?.points||0),pokemon:null};
}

async function handleCommand(env: Env, event: TwitchChatEvent) {
  const text = (event.message?.text ?? "").trim();
  if (!text.startsWith("!")) return;
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const login = norm(event.chatter_user_login);
  const display = event.chatter_user_name || login;
  const settings = await loadCommandSettings(env);
  const masterEnabled = await loadCommandMasterEnabled(env);

  // Emergency raffle cancel is resolved before warning/auto-finish and before stream-live
  // gating. If a raffle is active, !cancelraffle must always be able to invalidate it
  // immediately instead of racing the scheduled finisher.
  const cancelCfg = settings.cancelraffle;
  if (cancelCfg && commandMatchesConfig(cmd,cancelCfg,masterEnabled)) {
    if (!commandPermissionAllows(event,env,cancelCfg.permission)) return;
    if (!await tryEnterCloudCommandCooldown(env,"cancelraffle",event.chatter_user_id,cancelCfg)) return;
    const active = await getYuraRaffleState(env);
    if (!active?.active) {
      await sendChat(env,`@${display} nie ma aktywnego raffle.`);
      return;
    }
    if (active.mode === "jackpot" && active.jackpotId) {
      // Do not allow cancellation after the deadline to force a refund instead of drawing.
      const timerElapsed = Date.parse(active.endsAtUtc) <= Date.now();
      await finishJackpot(env,active.jackpotId,!timerElapsed);
      const outcome = await env.DB.prepare("SELECT status FROM jackpot_sessions WHERE id=?1").bind(active.jackpotId).first<{status:string}>();
      if (outcome?.status !== "paid" && outcome?.status !== "refunded") return;
    } else {
      await sendChat(env,"🎟️ Raffle anulowany.");
    }
    await setYuraRaffleState(env,null);
    return;
  }

  await warnYuraRaffleIfDue(env);
  await finishYuraRaffleIfDue(env);
  if (cmd === "!join") {
    const state = await getYuraRaffleState(env);
    if (!state?.active || state.mode === "auto" || Date.parse(state.endsAtUtc) <= Date.now()) return;
    if (state.mode === "jackpot") {
      if (!state.jackpotId || isYuraPointsBotLogin(login)) return;
      const previous = await env.DB.prepare("SELECT 1 x FROM jackpot_entries WHERE session_id=?1 AND login=?2").bind(state.jackpotId,login).first<any>();
      if (previous) { await sendChat(env,`🎰 @${display} już jesteś w jackpot.`); return; }
      const session = await env.DB.prepare("SELECT stake,status FROM jackpot_sessions WHERE id=?1").bind(state.jackpotId).first<any>();
      if (!session || session.status !== "open") return;
      await ensureAccount(env,event.chatter_user_id,login,display);
      try {
        await env.DB.prepare(`INSERT INTO jackpot_entries(session_id,login,twitch_user_id,display_name,stake,joined_at_utc)
          VALUES(?1,?2,?3,?4,?5,?6)`).bind(state.jackpotId,login,event.chatter_user_id,display,session.stake,nowIso()).run();
      } catch {
        const account = await getAccount(env,login);
        await sendChat(env,account && account.points < session.stake
          ? `🎰 @${display} potrzebujesz ${Number(session.stake).toLocaleString('pl-PL')} YURA (masz ${account.points.toLocaleString('pl-PL')}).`
          : `🎰 @${display} nie można dołączyć (duplikat lub zamknięte losowanie).`);
        return;
      }
      const count = await env.DB.prepare("SELECT COUNT(*) n FROM jackpot_entries WHERE session_id=?1").bind(state.jackpotId).first<{n:number}>();
      await sendChat(env,`🎰 @${display} dołączył do JACKPOT • ${Number(count?.n || 0)} graczy • pula ${(Number(count?.n || 0)*Number(session.stake)).toLocaleString('pl-PL')} YURA.`);
      return;
    }
    if (state.entries.some(x => x.login === login || (event.chatter_user_id && x.userId === event.chatter_user_id))) {
      await sendChat(env,`🎟️ @${display} już jesteś w raffle.`);
      return;
    }
    state.entries.push({ userId:event.chatter_user_id, login, display });
    await setYuraRaffleState(env,state);
    if (state.joinConfirmation !== false)
      await sendChat(env,`🎟️ @${display} dołączył do raffle • uczestników: ${state.entries.length}.`);
    return;
  }

  let match = Object.entries(settings).find(([,cfg]) => commandMatchesConfig(cmd,cfg,masterEnabled));
  // Build 311: numeric death increments belong to the same DEDGE command/policy.
  // The legacy DEDGES config is retained only for settings compatibility and is not executable.
  if (match?.[0] === "deathsAmount") match = undefined;
  if (!match) {
    // OWN commands use the same independent CLOUD 24/7 / STREAM ON policy as fixed commands.
    const customCommands = await loadCustomCommands(env);
    const custom = customCommands.find(x => x.enabled &&
      x.aliases.split(",").map(a => a.trim().toLowerCase()).includes(cmd));
    if (custom) {
      if (!custom.alwaysOnline && !(custom.streamOn && await isStreamLiveForOnlineCommand(env))) return;
      const cooldownConfig: CommandConfig = {
        enabled: true, alwaysOnline: custom.alwaysOnline, streamOn: custom.streamOn, aliases: custom.aliases, permission: custom.permission,
        userCooldown: custom.userCooldown, globalCooldown: custom.globalCooldown
      };
      if (!commandPermissionAllows(event,env,custom.permission)) return;
      if (!await tryEnterCloudCommandCooldown(env, `custom:${custom.id}`, event.chatter_user_id, cooldownConfig)) return;
      await sendChat(env, custom.message);
      return;
    }

    const suggestion = findYuraPointsCommandSuggestion(cmd,settings,masterEnabled);
    if (suggestion) await sendChat(env, `@${display} niepoprawna komenda YURA. Spróbuj: ${suggestion}.`);
    return;
  }
  const [key,cfg] = match;

  // ONLINE commands must work on the FIRST chat message after going live.
  // stream_live is refreshed by EventSub/cron, but either may lag the actual start.
  // If the cached flag is still OFFLINE, verify Twitch directly before rejecting.
  if (!cfg.alwaysOnline && !(cfg.streamOn && await isStreamLiveForOnlineCommand(env))) {
    if(key==="jackpot")await sendChat(env,`🎰 @${display} !jackpot działa tylko podczas transmisji (ONLINE).`);
    return;
  }
  // Jackpot accepts all viewers even with older moderator-only persisted permissions.
  if (key !== "jackpot" && !commandPermissionAllows(event,env,cfg.permission)) return;
  if (key !== "jackpot" && key !== "raffle" && key !== "sraffle" && key !== "autoraffle" && !await tryEnterCloudCommandCooldown(env,key,event.chatter_user_id,cfg)) return;

  if (key === "alertcontrol") {
    // Alert queue controls are intentionally local: Desktop forwards them to Streamer.bot.
    // Cloud only claims the command so it never emits an "unknown command" reply.
    return;
  }

  if (key === "autoraffle") {
    const active = await getYuraRaffleState(env);
    if (active?.active) { await sendChat(env,`@${display} raffle już trwa.`); return; }
    const prizeArg = parts[1];
    if (prizeArg && (!/^\d+$/.test(prizeArg) || !Number.isSafeInteger(Number(prizeArg)) || Number(prizeArg)<10 || Number(prizeArg)>1000000)) {
      await sendChat(env,`🎟️ @${display} podaj pulę od 10 do 1 000 000 YURA, np. !autoraffle 1000.`); return;
    }
    const prize = prizeArg ? Number(prizeArg) : 1000;
    const chatters = await getCurrentChatters(env);
    if (chatters.length < 3) { await sendChat(env,`🎟️ @${display} auto-raffle wymaga co najmniej 3 widzów.`); return; }
    const entries:YuraRaffleEntry[] = chatters.map((x:any) => ({
      userId:String(x?.user_id ?? ""),login:norm(x?.user_login ?? ""),display:String(x?.user_name ?? x?.user_login ?? "")
    }));
    const duration = 6;
    if(!await tryStartRaffleFamily(env,display,duration,cfg))return;
    const state:YuraRaffleState = {
      active:true,mode:"auto",id:crypto.randomUUID(),prize,
      endsAtUtc:new Date(Date.now()+duration*1000).toISOString(),durationSeconds:duration,
      entries,winnerCount:3,warningSent:true,joinConfirmation:false,warning20Seconds:false,warningFinalThird:false
    };
    await setYuraRaffleState(env,state);
    await sendChat(env,`🎟️ Auto-raffle • pula ${prize.toLocaleString('pl-PL')} YURA • 3 zwycięzców (50/35/15%) • losowanie za 6s.`);
    await new Promise(resolve => setTimeout(resolve,duration*1000));
    await finishYuraRaffleIfDue(env);
    return;
  }

  if (key === "jackpot") {
    const stakeRaw=parts[1];
    const validStake=!!stakeRaw && /^\d+$/.test(stakeRaw)
      && Number.isSafeInteger(Number(stakeRaw)) && Number(stakeRaw)>=1 && Number(stakeRaw)<=1000000;
    // Length is configured in YURA Desktop and synced to Cloud. A second
    // chat argument cannot change the streamer's configured duration.
    if(!validStake || parts.length!==2){
      await sendChat(env,`🎰 @${display} użyj !jackpot <wpisowe>, np. !jackpot 1000. Czas losowania ustawia streamer w aplikacji YURA.`);
      return;
    }
    const active=await getYuraRaffleState(env);
    if(active?.active){
      await sendChat(env,`🎰 @${display} ${active.mode==="jackpot"?"Jackpot":"Inne raffle"} już trwa. ${active.mode==="jackpot"?"Dołącz: !join.":"Spróbuj po zakończeniu."}`);
      return;
    }
    const remaining=await remainingJackpotCooldownSeconds(env,event.chatter_user_id,cfg);
    if(remaining>0){
      await sendChat(env,`🎰 @${display} cooldown Jackpota: jeszcze ${remaining} s. Spróbuj ponownie po odliczaniu.`);
      return;
    }
    const stake=Number(stakeRaw);
    // Opening a jackpot is the author\u2019s first paid !join. Verify the
    // author\u2019s balance before taking the shared Raffle / Jackpot start gate.
    if(isYuraPointsBotLogin(login) || !/^\d+$/.test(String(event.chatter_user_id||""))){
      await sendChat(env,`🎰 @${display} nie można uruchomić Jackpota z konta bota lub bez identyfikatora Twitch.`);
      return;
    }
    await ensureAccount(env,event.chatter_user_id,login,display);
    const authorAccount=await getAccount(env,login);
    if(!authorAccount || Number(authorAccount.points)<stake){
      await sendChat(env,`🎰 @${display} potrzebujesz ${stake.toLocaleString("pl-PL")} YURA, aby uruchomić Jackpot i automatycznie dołączyć (masz ${Number(authorAccount?.points||0).toLocaleString("pl-PL")}).`);
      return;
    }
    const configured=Math.max(5,Math.min(3600,Math.trunc(Number(cfg.defaultDurationSeconds ?? 60))||60));
    const duration=configured;
    const endsAtUtc=new Date(Date.now()+duration*1000).toISOString();
    if(!await tryStartRaffleFamily(env,display,duration,cfg))return;
    let newSession=0;
    try {
      const createdAt=nowIso();
      // Cloudflare D1 batch is a transaction: if debit fails, session creation
      // and the jackpot_entries insert roll back together. The INSERT trigger
      // debits the author exactly once and records a transaction audit entry.
      const batch=await env.DB.batch([
        env.DB.prepare(`INSERT INTO jackpot_sessions(stake,ends_at_utc,created_at_utc) VALUES(?1,?2,?3)`)
          .bind(stake,endsAtUtc,createdAt),
        env.DB.prepare(`INSERT INTO jackpot_entries(session_id,login,twitch_user_id,display_name,stake,joined_at_utc)
          SELECT id,?1,?2,?3,?4,?5 FROM jackpot_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`)
          .bind(login,event.chatter_user_id,display,stake,createdAt)
      ]);
      if(Number(batch[0]?.meta?.changes||0)!==1 || Number(batch[1]?.meta?.changes||0)!==1)
        throw new Error("Jackpot start did not create one funded participant");
      newSession=Number(batch[0]?.meta?.last_row_id||0);
      if(!Number.isSafeInteger(newSession) || newSession<=0){
        const sessionRow=await env.DB.prepare(`SELECT id FROM jackpot_sessions WHERE status='open' ORDER BY id DESC LIMIT 1`).first<{id:number}>();
        newSession=Number(sessionRow?.id||0);
      }
      if(!newSession)throw new Error("Jackpot session identifier unavailable");
    } catch(e){
      // No session or debit persists on D1 batch failure; unlock the shared
      // family gate so an invalid attempt cannot block another viewer.
      if(newSession){
        try {await finishJackpot(env,newSession,true);}catch(refundError){console.error("Jackpot automatic join refund failed",String(refundError));}
      }
      await env.DB.prepare(`DELETE FROM command_cooldowns WHERE command_key=?1 AND user_id='*'`)
        .bind(RAFFLE_SHARED_START_KEY).run();
      console.warn("Jackpot organizer auto-join failed",String(e));
      const current=await getAccount(env,login);
      await sendChat(env,Number(current?.points||0)<stake
        ? `🎰 @${display} nie masz już wystarczająco punktów (${Number(current?.points||0).toLocaleString("pl-PL")} YURA). Jackpot nie wystartował.`
        : `🎰 @${display} nie udało się bezpiecznie uruchomić Jackpota. Spróbuj ponownie — nie otwarto pustej sesji.`);
      return;
    }
    const state:YuraRaffleState={active:true,mode:"jackpot",prize:stake,endsAtUtc,durationSeconds:duration,
      entries:[{userId:event.chatter_user_id,login,display}],
      jackpotId:newSession,winnerCount:1,warningSent:true,joinConfirmation:true};
    await setYuraRaffleState(env,state);
    await tryEnterCloudCommandCooldown(env,JACKPOT_START_COOLDOWN_KEY,event.chatter_user_id,cfg);
    await sendChat(env,`🎰 JACKPOT wystartował! • wpisowe ${stake.toLocaleString("pl-PL")} YURA • ${duration}s • @${display} dołączył automatycznie (1 gracz, pula ${stake.toLocaleString("pl-PL")} YURA) • dołącz: !join!`);
    return;
  }
  if (key === "raffle" || key === "sraffle" || key === "jackpot") {
    const active = await getYuraRaffleState(env);
    if (active?.active && Date.parse(active.endsAtUtc) > Date.now()) {
      await sendChat(env,`@${display} raffle już trwa. Dołącz: !join.`);
      return;
    }
    const defaultPrize = key === "sraffle" ? 1000 : 5000;
    const prize = Math.max(1,Math.min(1000000,Math.trunc(Number(parts[1] ?? defaultPrize)) || defaultPrize));
    const configuredDuration = Math.max(5,Math.min(3600,Math.trunc(Number(cfg.defaultDurationSeconds ?? 60)) || 60));
    const duration = Math.max(5,Math.min(3600,Math.trunc(Number(parts[2] ?? configuredDuration)) || configuredDuration));
    if(!await tryStartRaffleFamily(env,display,duration,cfg))return;
    const state:YuraRaffleState = { active:true, mode:key === "sraffle" ? "single" : "multi", prize, endsAtUtc:new Date(Date.now()+duration*1000).toISOString(), durationSeconds:duration, entries:[{ userId:event.chatter_user_id, login, display }], warningSent:false, joinConfirmation:cfg.joinConfirmation !== false, warning20Seconds:cfg.warning20Seconds !== false, warningFinalThird:cfg.warningFinalThird !== false };
    await setYuraRaffleState(env,state);
    await sendChat(env,key === "sraffle"
      ? `🎟️ Raffle o ${prize.toLocaleString("pl-PL")} YURA • ${duration}s • jeden zwycięzca • wpisz !join.`
      : `🎟️ Multi-raffle o ${prize.toLocaleString("pl-PL")} YURA • ${duration}s • wpisz !join.`);
    return;
  }
  if (key === "deaths") {
    // The broadcaster's own channel may execute numeric increments. Other viewers
    // can increment by one; VIPs and moderators can specify an amount.
    let amount = 1;
    if (parts.length > 1) {
      if (!/^\d+$/.test(parts[1])) return;
      const parsed = Number(parts[1]);
      if (!Number.isSafeInteger(parsed) || parsed < 1) return;
      amount = Math.min(9999, parsed);
      if (amount > 1 && !commandPermissionAllows(event, env, "VIP")) return;
    }
    // A missing ready flag previously silently discarded all commands.
    // Never replace an existing count when initializing the cloud state.
    const rows = await env.DB.prepare("SELECT key,value FROM meta WHERE key IN ('death_active_counter','death_count_1','death_count_2','death_count_3')").all<{key:string,value:string}>();
    const deathMeta = new Map<string,string>((rows.results ?? []).map(x => [String(x.key), String(x.value ?? "")] as [string,string]));
    const active = Math.max(1, Math.min(3, Math.trunc(Number(deathMeta.get("death_active_counter") ?? 1)) || 1));
    const keyName = `death_count_${active}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_state_ready','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_active_counter',?1) ON CONFLICT(key) DO NOTHING").bind(String(active)),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES(?1,'0') ON CONFLICT(key) DO NOTHING").bind(keyName),
      env.DB.prepare("UPDATE meta SET value=CAST(MIN(999999,MAX(0,CAST(value AS INTEGER))+?1) AS TEXT) WHERE key=?2").bind(amount,keyName)
    ]);
    const next = Math.max(0,Number(await getMetaValue(env,keyName)) || 0);
    await logCloudEvent(env, "DEATHS", login, display, `RPG ${active} +${amount} -> ${next}`, amount);
    return;
  }

  if (key === "points") {
    const target = parts[1] ? norm(parts[1]) : login;
    const row = await getAccount(env, target);
    await sendChat(env, `@${display} ${target}: ${(row?.points ?? 0).toLocaleString("pl-PL")} YURA.`);
    return;
  }
  if (key === "pokemon" || key === "pokeroll") {
    const access=await pokemonFollowerAccess(env,event);
    if(access==='not-following'){
      await sendChat(env,`@${display} udział w Pokémon jest tylko dla obserwujących kanał. Kliknij Follow na Twitchu i spróbuj ponownie.`);
      return;
    }
    if(access==='unavailable'){
      await sendChat(env,`@${display} nie mogę teraz potwierdzić follow na Twitchu. Spróbuj ponownie później — nic nie zostało wylosowane ani pobrane.`);
      return;
    }
  }
  if (key === "pokemon") {
    if(parts.length!==1) {
      await sendChat(env,`@${display} użyj !pokemon, aby wylosować pierwszego Pokémona za darmo lub sprawdzić już przypisanego. Nowe losowanie: !pokeroll (5 000 YURA).`);
      return;
    }
    const assigned=await assignFirstPokemonForChat(env,event);
    if(!assigned) {
      await sendChat(env,`@${display} nie udało się pobrać Pokémona. Spróbuj ponownie za chwilę; żadne punkty nie zostały pobrane.`);
    } else if(assigned.created) {
      await sendChat(env,`🎲 @${display} Twój pierwszy Pokémon to ${assigned.name} (#${assigned.id})! Jest Twój na stałe i nic nie kosztował. Nowy los: !pokeroll za 5 000 YURA.`);
    } else {
      await sendChat(env,`🎮 @${display} Twój Pokémon: ${assigned.name} (#${assigned.id}). Nowy los: !pokeroll za 5 000 YURA.`);
    }
    return;
  }
  if (key === "pokeroll") {
    if(parts.length!==1){await sendChat(env,`@${display} użyj !pokeroll (5 000 YURA). Pierwszy Pokémon: !pokemon za darmo.`);return;}
    const result=await rerollPokemonForChat(env,event);
    if(result.status==='changed' && result.pokemon) {
      await sendChat(env,`🎲 @${display} wylosowano ${result.pokemon.name} (#${result.pokemon.id}) za 5 000 YURA! Saldo: ${result.balance.toLocaleString('pl-PL')} YURA.`);
    } else if(result.status==='unassigned') {
      await sendChat(env,`@${display} najpierw użyj !pokemon — pierwszy Pokémon jest za darmo.`);
    } else if(result.status==='insufficient') {
      await sendChat(env,`@${display} !pokeroll kosztuje 5 000 YURA. Masz: ${result.balance.toLocaleString('pl-PL')} YURA.`);
    } else if(result.status==='unavailable') {
      await sendChat(env,`@${display} chwilowo nie udało się wylosować Pokémona. Nie pobrano punktów.`);
    }
    return;
  }
  if (key === "watchtime") {
    const target = parts[1] ? norm(parts[1]) : login;
    const row = await getAccount(env, target);
    await sendChat(env, `@${display} watchtime ${target}: ${formatWatch(row?.watch_seconds ?? 0)}.`);
    return;
  }
  if (key === "top") {
    // Filter BEFORE LIMIT 5 so high-balance bots never consume a ranking slot.
    // Cloud owns !top while available; changing Desktop alone cannot fix this reply.
    const rows = await env.DB.prepare(`SELECT display_name,login,points FROM accounts
      WHERE points>0 AND (twitch_user_id IS NULL OR (twitch_user_id<>?1 AND twitch_user_id<>?2))
      ${PUBLIC_LEADERBOARD_BOT_SQL}
      ORDER BY points DESC, display_name COLLATE NOCASE LIMIT 5`)
      .bind(String(env.TWITCH_BROADCASTER_ID || ""), String(env.TWITCH_BOT_USER_ID || "")).all<any>();
    const top = (rows.results ?? []).filter((x:any) =>
      !knownBotLogin(String(x.login ?? "")) && !knownBotLogin(String(x.display_name ?? "")));
    const summary = top.map((x:any,i:number)=>`#${i+1} ${x.display_name||x.login} ${Number(x.points).toLocaleString("pl-PL")}`).join(" • ");
    await sendChat(env, `🏆 ${summary || "ranking jest pusty"}`);
    return;
  }
  if (key === "add" || key === "remove") {
    const target = norm(parts[1] ?? "");
    const amount = Math.trunc(Number(parts[2] ?? 0));
    const primary = cfg.aliases.split(",").map(x=>x.trim()).find(Boolean) || `!${key}`;
    const usage = key === "add"
      ? `${primary} @nick <liczba> lub ${primary} all <liczba>`
      : `${primary} @nick <liczba>`;
    if (!target || !Number.isFinite(amount) || amount <= 0) {
      await sendChat(env, `@${display} użyj: ${usage}.`);
      return;
    }
    if (key === "add" && target === "all") {
      const viewers = await getCurrentChatters(env);
      let awarded = 0;
      for (const viewer of viewers) {
        const viewerLogin = norm(viewer?.user_login ?? "");
        if (!viewerLogin) continue;
        await addPoints(env, String(viewer?.user_id ?? ""), viewerLogin, String(viewer?.user_name ?? viewerLogin), amount, `add all present by ${login}`, "chat-admin");
        awarded++;
      }
      await sendChat(env, `@${display} dodano ${amount.toLocaleString("pl-PL")} YURA wszystkim obecnym: ${awarded.toLocaleString("pl-PL")} osobom.`);
      return;
    }
    if (key === "remove" && target === "all") {
      await sendChat(env, `@${display} REMOVE nie obsługuje all. Użyj: ${usage}.`);
      return;
    }
    const delta = key === "remove" ? -amount : amount;
    const balance = await addPoints(env, "", target, target, delta, `${key} by ${login}`, "chat-admin");
    await sendChat(env, key === "remove"
      ? `@${display} usunięto ${amount.toLocaleString("pl-PL")} YURA z @${target}. Saldo: ${balance.toLocaleString("pl-PL")}.`
      : `@${display} dodano ${amount.toLocaleString("pl-PL")} YURA dla @${target}. Saldo: ${balance.toLocaleString("pl-PL")}.`);
    return;
  }
  if (key === "gamble") {
    const row = await getAccount(env, login);
    const current = row?.points ?? 0;
    const wagerArg = String(parts[1] ?? "").trim().toLowerCase();
    let stake = 0;
    if (wagerArg === "all" || wagerArg === "max") {
      stake = current;
    } else if (wagerArg.endsWith("%")) {
      const percent = Number(wagerArg.slice(0, -1).replace(",", "."));
      if (Number.isFinite(percent) && percent > 0 && percent <= 100 && current > 0)
        stake = Math.max(1, Math.floor(current * percent / 100));
      else
        stake = Number.NaN;
    } else {
      stake = Math.trunc(Number(wagerArg || 0));
    }
    if (!Number.isFinite(stake) || stake <= 0 || stake > current) {
      const primary = cfg.aliases.split(",").map(x=>x.trim()).find(Boolean) || "!gamble";
      await sendChat(env, `@${display} użyj: ${primary} <kwota|procent%|all>. Masz ${Number(current).toLocaleString("pl-PL")} YURA.`);
      return;
    }
    const winPercent = Math.max(0, Math.min(100, Number(cfg.winPercent ?? 50)));
    const critWinPercent = Math.max(0, Math.min(100 - winPercent, Number(cfg.critWinPercent ?? 1)));
    const rollPercent = (crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000) * 100;
    const critWin = rollPercent < critWinPercent;
    const win = !critWin && rollPercent < critWinPercent + winPercent;

    // The operator controls total CRIT WIN chance. Once CRIT triggers, payout tier is fixed:
    // 90% -> 2x, 9% -> 3x, 1% -> 5x.
    let critMultiplier = 0;
    if (critWin) {
      const critTierRoll = (crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000) * 100;
      critMultiplier = critTierRoll < 90 ? 2 : critTierRoll < 99 ? 3 : 5;
    }

    const delta = critWin ? stake * critMultiplier : win ? stake : -stake;
    const balance = await addPoints(env, event.chatter_user_id, login, display, delta, critWin ? `gamble crit win x${critMultiplier}` : "gamble", "chat");
    await logCloudEvent(env, "GAMBLE", login, display, critWin ? `crit x${critMultiplier}` : (win ? "win" : "loss"), delta);
    // Dedicated all-in stats. Other gamble stakes do not count as gamble ALL.
    // Never expose amounts, access tokens or message contents to public stats.
    if (wagerArg === "all" && event.message_id) {
      try {
        await env.DB.prepare(`INSERT OR IGNORE INTO stats_gamble_all
          (event_id,twitch_user_id,login,outcome,created_at_utc) VALUES(?1,?2,?3,?4,?5)`)
          .bind(String(event.message_id),String(event.chatter_user_id),login,critWin||win?'win':'loss',nowIso()).run();
      } catch (statsError) { console.warn('YURA gamble all stats failed',String(statsError)); }
    }
    // Separate prize roll, only for literal !gamble all (max is excluded).
    if (wagerArg === "all") {
      try { await maybeGrantPermanentVip(env,event,stake,critWin||win); }
      catch (err:any) { console.warn("VIP bonus error",String(err?.message??err)); }
    }
    await sendChat(env, critWin
      ? `@${display} 💥 CRIT WIN x${critMultiplier} +${delta.toLocaleString("pl-PL")} YURA • saldo ${balance.toLocaleString("pl-PL")}.`
      : win
        ? `@${display} 🎲 WYGRANA +${stake.toLocaleString("pl-PL")} YURA • saldo ${balance.toLocaleString("pl-PL")}.`
        : `@${display} 🎲 przegrana -${stake.toLocaleString("pl-PL")} YURA • saldo ${balance.toLocaleString("pl-PL")}.`);
    return;
  }
  if (key === "uptime") {
    // Get Streams also accepts a normal user token. The bot token is already
    // proven valid by chat sending, making this path independent of app-token creation.
    const res = await twitchApi(env, `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}`, {}, "bot");
    const body:any = res.ok ? await res.json() : null;
    const stream = Array.isArray(body?.data) && body.data.length ? body.data[0] : null;
    if (!stream?.started_at) await sendChat(env, `@${display} stream jest teraz offline.`);
    else {
      const sec = Math.max(0, Math.floor((Date.now()-Date.parse(stream.started_at))/1000));
      await sendChat(env, `@${display} uptime: ${Math.floor(sec/3600)}h ${String(Math.floor((sec%3600)/60)).padStart(2,"0")}m.`);
    }
    return;
  }
  if (key === "accountage" || key === "followage") {
    const target = parts[1] ? norm(parts[1]) : login;
    const user:any = await twitchUserByLogin(env,target);
    if (!user) { await sendChat(env, `@${display} nie znaleziono użytkownika ${target}.`); return; }
    if (key === "accountage") {
      await sendChat(env, `@${display} konto ${user.display_name || target} ma ${formatAge(String(user.created_at ?? ""))}.`);
      return;
    }
    const res = await twitchApi(env, `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}&user_id=${encodeURIComponent(String(user.id))}&first=1`, {}, "broadcaster");
    const body:any = res.ok ? await res.json() : null;
    const followed = Array.isArray(body?.data) && body.data.length ? body.data[0]?.followed_at : null;
    await sendChat(env, followed
      ? `@${display} ${user.display_name || target} obserwuje kanał od ${formatAge(String(followed))}.`
      : `@${display} ${user.display_name || target} nie obserwuje kanału.`);
  }
}

function tibiaTotalExpForLevel(level:number): number {
  const l = Math.max(1, Math.trunc(level));
  if (l <= 1) return 0;
  return Math.max(0, Math.trunc((50 * (l*l*l - 6*l*l + 17*l - 12)) / 3));
}

function tibiaLevelForExp(exp:number): number {
  const value = Math.max(0, Math.trunc(exp || 0));
  let lo = 1;
  let hi = 2;
  while (hi < 1000000 && tibiaTotalExpForLevel(hi) <= value) {
    lo = hi;
    hi = Math.min(1000000, hi * 2);
    if (hi === lo) break;
  }
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (tibiaTotalExpForLevel(mid) <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

type ExpSettings = { per_message:number; first_message_bonus:number; per_level:number };

async function expSettings(env: Env): Promise<ExpSettings> {
  const fallback: ExpSettings = {
    per_message: Math.max(0, Math.trunc(num(env.EXP_PER_MESSAGE, 10))),
    first_message_bonus: Math.max(0, Math.trunc(num(env.EXP_FIRST_MESSAGE_BONUS, 300))),
    per_level: Math.max(1, Math.trunc(num(env.EXP_PER_LEVEL, 1000)))
  };
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key='exp_settings_json' LIMIT 1").first<{value:string}>();
  if (!row?.value) return fallback;
  try {
    const parsed:any = JSON.parse(row.value);
    return {
      per_message: Math.max(0, Math.min(100000, Math.trunc(Number(parsed?.per_message ?? fallback.per_message) || 0))),
      first_message_bonus: Math.max(0, Math.min(1000000, Math.trunc(Number(parsed?.first_message_bonus ?? fallback.first_message_bonus) || 0))),
      per_level: Math.max(1, Math.min(10000000, Math.trunc(Number(parsed?.per_level ?? fallback.per_level) || fallback.per_level)))
    };
  } catch { return fallback; }
}

async function apiExpSettings(env: Env) {
  const base = await expSettings(env);
  let raw:any = {};
  try {
    const value = await getMetaValue(env,"exp_settings_json");
    raw = value ? JSON.parse(value) : {};
  } catch {}
  return json({
    ok:true,
    ...base,
    watchtime_per_10m: Math.max(0, Math.trunc(Number(raw?.watchtime_per_10m ?? 0) || 0)),
    sub_t1: Math.max(0, Math.trunc(Number(raw?.sub_t1 ?? 1000) || 0)),
    sub_t2: Math.max(0, Math.trunc(Number(raw?.sub_t2 ?? 2000) || 0)),
    sub_t3: Math.max(0, Math.trunc(Number(raw?.sub_t3 ?? 5000) || 0)),
    gift_sub: Math.max(0, Math.trunc(Number(raw?.gift_sub ?? 750) || 0)),
    per_bit: Math.max(0, Math.trunc(Number(raw?.per_bit ?? 1) || 0)),
    donation_per_pln: Math.max(0, Math.trunc(Number(raw?.donation_per_pln ?? 20) || 0)),
    curve:"tibia"
  });
}

function normalizeLoginList(value:any): string[] {
  const src = Array.isArray(value) ? value : String(value ?? "").split(/[,;\s]+/);
  return [...new Set(src.map((x:any)=>norm(String(x ?? "").replace(/^@/,""))).filter(Boolean))];
}
async function loadPointsBlacklist(env: Env): Promise<Set<string>> {
  const raw = await getMetaValue(env,"points_blacklist_json");
  try { return new Set(normalizeLoginList(raw ? JSON.parse(raw) : [])); } catch { return new Set(); }
}
async function loadExpBlacklist(env: Env): Promise<Set<string>> {
  const raw = await getMetaValue(env,"exp_settings_json");
  try {
    const parsed:any = raw ? JSON.parse(raw) : {};
    const list = normalizeLoginList(parsed?.blacklist ?? []);
    ["yuranetwork","yuranetworkttv","streamelements","nightbot","sery_bot","serybot","streamlabs","moobot","fossabot","creatisbot","botrix"].forEach(x=>list.push(x));
    return new Set(list);
  } catch { return new Set(["yuranetwork","streamelements","nightbot","sery_bot","serybot"]); }
}
async function handlePointsReset(_req: Request, _env: Env) {
  // Since v3.3.100 YURA Points never reset between months.
  // The endpoint is deliberately a read-only compatibility rejection.
  return json({ok:false,error:'permanent_points',
    message:'YURA Points are permanent. Only monthly GAINS EXP rotates.'},410);
}

async function handlePointsBlacklist(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any; try { body=await req.json(); } catch { return json({error:"invalid json"},400); }
  const blacklist=normalizeLoginList(body?.blacklist ?? []);
  await setMeta(env,"points_blacklist_json",JSON.stringify(blacklist));
  return json({ok:true,blacklist});
}

async function handleExpSettings(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any;
  try { body = await req.json(); } catch { return json({error:"invalid json"},400); }
  const settings:any = {
    per_message: Math.max(0, Math.min(100000, Math.trunc(Number(body?.per_message ?? 10) || 0))),
    first_message_bonus: Math.max(0, Math.min(1000000, Math.trunc(Number(body?.first_message_bonus ?? 300) || 0))),
    watchtime_per_10m: Math.max(0, Math.min(1000000, Math.trunc(Number(body?.watchtime_per_10m ?? 0) || 0))),
    sub_t1: Math.max(0, Math.min(10000000, Math.trunc(Number(body?.sub_t1 ?? 1000) || 0))),
    sub_t2: Math.max(0, Math.min(10000000, Math.trunc(Number(body?.sub_t2 ?? 2000) || 0))),
    sub_t3: Math.max(0, Math.min(10000000, Math.trunc(Number(body?.sub_t3 ?? 5000) || 0))),
    gift_sub: Math.max(0, Math.min(10000000, Math.trunc(Number(body?.gift_sub ?? 750) || 0))),
    per_bit: Math.max(0, Math.min(100000, Math.trunc(Number(body?.per_bit ?? 1) || 0))),
    donation_per_pln: Math.max(0, Math.min(1000000, Math.trunc(Number(body?.donation_per_pln ?? 20) || 0))),
    blacklist: normalizeLoginList(body?.blacklist ?? []),
    per_level: 1000
  };
  await setMeta(env, "exp_settings_json", JSON.stringify(settings));
  return json({ok:true, ...settings, curve:"tibia"});
}

async function awardExpForChat(env: Env, event: TwitchChatEvent, login: string) {
  if ((await loadExpBlacklist(env)).has(norm(login))) return;
  const runtime = await env.DB.prepare(`SELECT key,value FROM meta WHERE key IN ('stream_live','stream_started_at_utc','exp_settings_json')`).all<{key:string,value:string}>();
  const meta = new Map<string,string>((runtime.results ?? []).map(x => [String(x.key), String(x.value ?? "")] as [string,string]));
  // EventSub / minute cron may lag when the first message arrives after go-live.
  // Confirm the stream directly only in that stale case, then persist its start key.
  if (meta.get('stream_live') !== '1' || !String(meta.get('stream_started_at_utc') ?? '').trim()) {
    try {
      const live = await getLiveStreamState(env);
      if (!live.live) return;
      const startedAt = live.startedAt || nowIso();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_live','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_started_at_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
          .bind(startedAt)
      ]);
      meta.set('stream_live','1');
      meta.set('stream_started_at_utc',startedAt);
    } catch (error) {
      console.warn('EXP live-state check failed', String(error));
      return;
    }
  }
  const streamKey = String(meta.get('stream_started_at_utc') ?? '').trim();
  if (!streamKey) return;

  const messageId = String(event.message_id ?? '').trim();

  let settings: ExpSettings = {
    per_message: Math.max(0, Math.trunc(num(env.EXP_PER_MESSAGE, 10))),
    first_message_bonus: Math.max(0, Math.trunc(num(env.EXP_FIRST_MESSAGE_BONUS, 300))),
    per_level: Math.max(1, Math.trunc(num(env.EXP_PER_LEVEL, 1000)))
  };
  const settingsRaw = meta.get('exp_settings_json');
  if (settingsRaw) {
    try {
      const parsed:any = JSON.parse(settingsRaw);
      settings = {
        per_message: Math.max(0, Math.min(100000, Math.trunc(Number(parsed?.per_message ?? settings.per_message) || 0))),
        first_message_bonus: Math.max(0, Math.min(1000000, Math.trunc(Number(parsed?.first_message_bonus ?? settings.first_message_bonus) || 0))),
        per_level: Math.max(1, Math.min(10000000, Math.trunc(Number(parsed?.per_level ?? settings.per_level) || settings.per_level)))
      };
    } catch {}
  }

  const current = await env.DB.prepare(`SELECT exp,exp_stream,exp_stream_key,last_exp_message_id FROM accounts WHERE login=?1 LIMIT 1`)
    .bind(login).first<any>();
  if (messageId && String(current?.last_exp_message_id ?? '') === messageId) return;
  const totalBefore = Math.max(0, Number(current?.exp ?? 0) || 0);
  const first = String(current?.exp_stream_key ?? '') !== streamKey;
  const streamBefore = first ? 0 : Math.max(0, Number(current?.exp_stream ?? 0) || 0);
  const award = settings.per_message + (first ? settings.first_message_bonus : 0);
  if (award <= 0) return;
  const totalAfter = totalBefore + award;
  const streamAfter = streamBefore + award;
  await ensureMonthlyLevelProgress(env);
  const levelUp = tibiaLevelForExp(totalAfter) > tibiaLevelForExp(totalBefore);
  const now = nowIso();
  await env.DB.prepare(`UPDATE accounts SET exp=?1,exp_stream=?2,exp_stream_key=?3,last_level_up_utc=CASE WHEN ?4=1 THEN ?5 ELSE last_level_up_utc END,last_exp_message_id=CASE WHEN ?6<>'' THEN ?6 ELSE last_exp_message_id END,last_write_utc=?5 WHERE login=?7`)
    .bind(totalAfter, streamAfter, streamKey, levelUp ? 1 : 0, now, messageId, login).run();
}

/* Lifetime public counts: the Twitch EventSub message ID is the dedupe key.
   This is independent of the optional verbose cloud_events history. */
async function countStatisticsChat(env: Env, event: TwitchChatEvent, login: string): Promise<void> {
  if (knownBotLogin(login) || event.chatter_user_id===env.TWITCH_BOT_USER_ID) return;
  const id=String(event.message_id||'').trim();
  if (!id) return; // Never manufacture an ID and risk duplicate counts.
  await env.DB.prepare(`INSERT OR IGNORE INTO stats_chat_messages
    (message_id,twitch_user_id,login,display_name,sent_at_utc)
    VALUES(?1,?2,?3,?4,?5)`)
    .bind(id,String(event.chatter_user_id||''),login,String(event.chatter_user_name||login).slice(0,120),nowIso()).run();
}

async function handleChatMessage(env: Env, event: TwitchChatEvent) {
  const login = norm(event.chatter_user_login);
  if (!login || event.chatter_user_id === env.TWITCH_BOT_USER_ID) return;
  const text = String(event.message?.text ?? "").trim();
  // Commands must not be lost if an unrelated first-message side effect (account,
  // EXP initialization, chat history or timer bookkeeping) fails after stream start.
  // Under normal conditions the original message/points flow is unchanged.
  try {
    if (!knownBotLogin(login)) {
      await logCloudEvent(env, "CHAT", login, event.chatter_user_name || login, text);
      if (text.startsWith("!")) {
        const token = text.split(/\s+/)[0].toLowerCase();
        await logCloudEvent(env, "COMMAND", login, event.chatter_user_name || login, token);
      }
    }
    if (!knownBotLogin(login) && await cloudFlag(env, "cloud_timers_enabled", true))
      await env.DB.prepare("UPDATE cloud_timers SET chat_count=chat_count+1 WHERE enabled=1").run();
    await ensureAccount(env, event.chatter_user_id, login, event.chatter_user_name);
    if (!knownBotLogin(login) && event.chatter_user_id !== env.TWITCH_BROADCASTER_ID)
      await awardExpForChat(env, event, login);
    const pointsBlacklist = await loadPointsBlacklist(env);
    const chatPoints = Math.max(0, num(env.POINTS_CHAT_MESSAGE, 10));
    if (!knownBotLogin(login) && !pointsBlacklist.has(login) && chatPoints > 0)
      await addPoints(env, event.chatter_user_id, login, event.chatter_user_name, chatPoints, "chat message", "eventsub");
  } catch (e) {
    console.warn("YURA chat side effect failed (command handler will still run)", String(e));
  }
  // A broken chat-points path must not prevent independent stats counting.
  try { await countStatisticsChat(env,event,login); }
  catch (e) { console.warn('YURA stats chat count failed',String(e)); }
  try {
    await handleCommand(env, event);
  } catch (e) {
    console.error("YURA cloud command failed", text.split(/\s+/)[0], String(e));
    throw e;
  }
}

async function getLiveStreamState(env: Env): Promise<{ live:boolean; startedAt:string }> {
  // A user token is valid for Get Streams; using the bot OAuth token here keeps
  // presence/watchtime sampling alive even if app-token creation is unavailable.
  const res = await twitchApi(env, `https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}`, {}, "bot");
  if (!res.ok) throw new Error(`Get Streams ${res.status}: ${await res.text()}`);
  const data:any = await res.json();
  const stream = Array.isArray(data.data) && data.data.length ? data.data[0] : null;
  return {
    live: !!stream,
    startedAt: stream?.started_at ? String(stream.started_at) : ""
  };
}

function emptyPendingPresence(lastSampleUtc = ""): PendingPresenceState {
  return { last_sample_utc: lastSampleUtc, present_count: 0, users: {} };
}

async function loadPendingPresence(env: Env): Promise<PendingPresenceState> {
  const raw = await getMetaValue(env, "presence_pending_json");
  try {
    const parsed:any = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const users = parsed.users && typeof parsed.users === "object" ? parsed.users : {};
      return {
        last_sample_utc: String(parsed.last_sample_utc ?? ""),
        present_count: Math.max(0, Number(parsed.present_count ?? 0) || 0),
        users
      };
    }
  } catch {}
  // First run after upgrading: reuse the previous per-minute sample as the baseline.
  return emptyPendingPresence(await getMetaValue(env, "last_presence_sample_utc"));
}

function addOfflineTail(pending: PendingPresenceState, now: Date) {
  const previousMs = pending.last_sample_utc ? Date.parse(pending.last_sample_utc) : 0;
  let elapsed = previousMs > 0 ? Math.floor((now.getTime() - previousMs) / 1000) : 0;
  if (elapsed <= 0 || elapsed > PRESENCE_SAMPLE_MAX_GAP_SECONDS) return;

  // Only viewers seen in the latest minute receive the final partial minute.
  for (const user of Object.values(pending.users)) {
    if (user.last_seen_utc === pending.last_sample_utc)
      user.seconds = Math.max(0, Math.trunc(Number(user.seconds) || 0)) + elapsed;
  }
}

async function flushPendingPresence(env: Env, pending: PendingPresenceState, flushAt: string) {
  let totalAward = 0;
  let totalWatch = 0;
  const ratePer10m = num(env.POINTS_BASE_PER_10M, 100);
  const pointsBlacklist = await loadPointsBlacklist(env);
  const expBlacklist = await loadExpBlacklist(env);
  let expWatchtimeRate = 0;
  try {
    const settingsRaw = await getMetaValue(env,'exp_settings_json');
    const settings = settingsRaw ? JSON.parse(settingsRaw) : {};
    expWatchtimeRate = Math.max(0,Math.min(1000000,Math.trunc(Number(settings?.watchtime_per_10m ?? 0) || 0)));
  } catch {}
  const shouldAwardWatchtimeExp = expWatchtimeRate > 0;
  // Baselines must be captured before any watchtime XP changes this month's totals.
  if (shouldAwardWatchtimeExp) await ensureMonthlyLevelProgress(env);
  const streamKey = await getMetaValue(env,'stream_started_at_utc');
  const monthKey = monthKeyWarsaw();

  for (const [loginRaw, user] of Object.entries(pending.users)) {
    const login = norm(loginRaw);
    const seconds = Math.max(0, Math.trunc(Number(user.seconds) || 0));
    if (!login || seconds <= 0) continue;

    const state = await env.DB.prepare("SELECT presence_remainder,watch_seconds,exp,exp_stream,exp_stream_key FROM accounts WHERE login=?1")
      .bind(login).first<any>();
    const remainder = Number(state?.presence_remainder ?? 0);
    const effectiveRate = pointsBlacklist.has(login) ? 0 : ratePer10m;
    const scaled = remainder + seconds * effectiveRate;
    const award = Math.floor(scaled / 600);
    const nextRemainder = scaled % 600;
    const seenAt = user.last_seen_utc || flushAt;
    const watchBefore = Math.max(0,Math.trunc(Number(state?.watch_seconds ?? 0) || 0));
    const excludeExp = expBlacklist.has(login) || knownBotLogin(login) ||
      String(user.user_id || '') === String(env.TWITCH_BROADCASTER_ID || '') ||
      String(user.user_id || '') === String(env.TWITCH_BOT_USER_ID || '');
    // No per-user migration is needed: the difference of cumulative floors pays
    // only for this new window (never backfills old watchtime from prior months).
    const expToAdd = shouldAwardWatchtimeExp && !excludeExp
      ? Math.max(0,Math.floor((watchBefore + seconds) * expWatchtimeRate / 600) -
          Math.floor(watchBefore * expWatchtimeRate / 600)) : 0;
    const oldExp = Math.max(0,Number(state?.exp ?? 0) || 0);
    const nextExp = oldExp + expToAdd;
    const levelUp = expToAdd > 0 && tibiaLevelForExp(nextExp) > tibiaLevelForExp(oldExp);
    totalAward += Math.max(0, award);
    totalWatch += seconds;

    if (!state) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO accounts(login,twitch_user_id,display_name,points,watch_seconds,last_seen_utc,presence_remainder,created_at_utc,last_write_utc,exp,exp_stream,exp_stream_key,last_level_up_utc)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,?9,?9,?10,?11)`)
          .bind(login, user.user_id || "", user.display_name || login, award, seconds, seenAt, nextRemainder, flushAt, expToAdd, streamKey || '', levelUp ? flushAt : ''),
        ...(expToAdd > 0 ? [env.DB.prepare(`INSERT OR IGNORE INTO vip_monthly_levels(month_key,login,base_exp,created_at_utc) VALUES(?1,?2,0,?3)`)
          .bind(monthKey,login,flushAt)] : []),
        ...(award !== 0 ? [env.DB.prepare(`INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
          SELECT twitch_user_id,login,display_name,?1,points,'presence accrual','cloud-cron',?2 FROM accounts WHERE login=?3`)
          .bind(award, flushAt, login)] : [])
      ]);
    } else {
      await env.DB.batch([
        env.DB.prepare(`UPDATE accounts SET
            twitch_user_id=CASE WHEN ?1<>'' THEN ?1 ELSE twitch_user_id END,
            display_name=?2,
            watch_seconds=watch_seconds+?3,
            points=points+?4,
            last_seen_utc=?5,
            presence_remainder=?6,
            last_write_utc=?7,
            exp=exp+?9,
            exp_stream=CASE WHEN ?9<=0 THEN exp_stream WHEN ?10<>'' AND exp_stream_key<>?10 THEN ?9 ELSE exp_stream+?9 END,
            exp_stream_key=CASE WHEN ?9>0 AND ?10<>'' THEN ?10 ELSE exp_stream_key END,
            last_level_up_utc=CASE WHEN ?11=1 THEN ?7 ELSE last_level_up_utc END
          WHERE login=?8`)
          .bind(user.user_id || "", user.display_name || login, seconds, award, seenAt, nextRemainder, flushAt, login, expToAdd, streamKey || '', levelUp ? 1 : 0),
        ...(award !== 0 ? [env.DB.prepare(`INSERT INTO transactions(twitch_user_id,login,display_name,delta,balance_after,reason,source,created_at_utc)
          SELECT twitch_user_id,login,display_name,?1,points,'presence accrual','cloud-cron',?2 FROM accounts WHERE login=?3`)
          .bind(award, flushAt, login)] : [])
      ]);
    }
  }

  pending.users = {};
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('presence_pending_json',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(JSON.stringify(pending)),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('last_presence_sample_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(pending.last_sample_utc || flushAt),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('presence_count',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(String(pending.present_count)),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('last_points_awarded',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(String(totalAward)),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('last_watch_added_seconds',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(String(totalWatch))
  ]);
}

async function flushPresenceOnStreamEnd(env: Env) {
  const pending = await loadPendingPresence(env);
  if (!Object.keys(pending.users).length) return;
  const now = new Date();
  addOfflineTail(pending, now);
  pending.last_sample_utc = now.toISOString();
  pending.present_count = 0;
  await flushPendingPresence(env, pending, now.toISOString());
}

async function samplePresence(env: Env, flushAccounts: boolean) {
  const now = new Date();
  const nowText = now.toISOString();
  const pending = await loadPendingPresence(env);
  const previousMs = pending.last_sample_utc ? Date.parse(pending.last_sample_utc) : 0;
  let elapsed = previousMs > 0 ? Math.floor((now.getTime() - previousMs) / 1000) : 0;
  if (elapsed < 0 || elapsed > PRESENCE_SAMPLE_MAX_GAP_SECONDS) elapsed = 0;

  const streamState = await getLiveStreamState(env);
  if (!streamState.live) {
    const wasLive = (await getMetaValue(env, "stream_live")) === "1";
    if (wasLive || Object.keys(pending.users).length) {
      addOfflineTail(pending, now);
      pending.last_sample_utc = nowText;
      pending.present_count = 0;
      await flushPendingPresence(env, pending, nowText);
    }
    if (wasLive) {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_live','0') ON CONFLICT(key) DO UPDATE SET value='0'"),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_started_at_utc','') ON CONFLICT(key) DO UPDATE SET value=''"),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('presence_count','0') ON CONFLICT(key) DO UPDATE SET value='0'")
      ]);
    }
    return;
  }

  if ((await getMetaValue(env, "stream_live")) !== "1") await setMeta(env, "stream_live", "1");
  if (streamState.startedAt && (await getMetaValue(env, "stream_started_at_utc")) !== streamState.startedAt)
    await setMeta(env, "stream_started_at_utc", streamState.startedAt);

  const url = `https://api.twitch.tv/helix/chat/chatters?broadcaster_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}&moderator_id=${encodeURIComponent(env.TWITCH_BOT_USER_ID)}&first=1000`;
  const res = await twitchApi(env, url, {}, "bot");
  if (!res.ok) throw new Error(`Get Chatters ${res.status}: ${await res.text()}`);
  const data:any = await res.json();
  const viewers:any[] = Array.isArray(data.data) ? data.data : [];
  let presentCount = 0;

  for (const v of viewers) {
    const login = norm(v.user_login ?? "");
    if (!login || v.user_id === env.TWITCH_BOT_USER_ID) continue;
    presentCount++;
    const current = pending.users[login] ?? {
      user_id: String(v.user_id ?? ""),
      display_name: String(v.user_name ?? login),
      seconds: 0,
      last_seen_utc: nowText
    };
    current.user_id = String(v.user_id ?? current.user_id ?? "");
    current.display_name = String(v.user_name ?? current.display_name ?? login);
    if (elapsed > 0) current.seconds = Math.max(0, Math.trunc(Number(current.seconds) || 0)) + elapsed;
    current.last_seen_utc = nowText;
    pending.users[login] = current;
  }

  pending.last_sample_utc = nowText;
  pending.present_count = presentCount;

  if (flushAccounts) {
    await flushPendingPresence(env, pending, nowText);
  } else {
    // One compact D1 row per minute keeps minute-level presence accuracy while
    // account/watchtime/transaction writes are batched every 10 minutes.
    await setMeta(env, "presence_pending_json", JSON.stringify(pending));
  }
}


type DiscordMemberSnapshot = {
  user_id: string;
  username: string;
  display_name: string;
  is_bot: number;
};

type DiscordMemberCheckResult = {
  ok: boolean;
  baseline_created: boolean;
  current_count: number;
  previous_count: number;
  joined: DiscordMemberSnapshot[];
  left: DiscordMemberSnapshot[];
  checked_at_utc: string;
};

async function getMetaValue(env: Env, key: string) {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key=?1").bind(key).first<{value:string}>();
  return String(row?.value ?? "");
}

async function discordRequest(env: Env, path: string, init: RequestInit = {}) {
  const token = String(env.DISCORD_BOT_TOKEN ?? "").trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN is missing in Worker secrets.");
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bot ${token}`);
  headers.set("User-Agent", "YURA-Cloud/3.2.8");
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`https://discord.com/api/v10/${path.replace(/^\/+/, "")}`, { ...init, headers });
}

async function getDiscordGuildMembers(env: Env, guildId: string): Promise<DiscordMemberSnapshot[]> {
  const result: DiscordMemberSnapshot[] = [];
  let after = "";
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ limit: "1000" });
    if (after) query.set("after", after);
    const res = await discordRequest(env, `guilds/${encodeURIComponent(guildId)}/members?${query.toString()}`);
    if (!res.ok) throw new Error(`Discord members ${res.status}: ${(await res.text()).slice(0,500)}`);
    const rows:any = await res.json();
    if (!Array.isArray(rows)) break;
    for (const member of rows) {
      const user = member?.user ?? {};
      const id = String(user?.id ?? "").trim();
      if (!id) continue;
      result.push({
        user_id: id,
        username: String(user?.username ?? "").trim(),
        display_name: String(member?.nick ?? user?.global_name ?? user?.username ?? id).trim(),
        is_bot: user?.bot === true ? 1 : 0
      });
      after = id;
    }
    if (rows.length < 1000) break;
  }
  return result;
}

async function sendDiscordLeaveMessage(env: Env, channelId: string, text: string) {
  const res = await discordRequest(env, `channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: text.slice(0,2000), allowed_mentions: { parse: [] } })
  });
  if (!res.ok) throw new Error(`Discord send ${res.status}: ${(await res.text()).slice(0,500)}`);
}

async function checkDiscordMembers(env: Env, options?: { manual?: boolean; notifyLeaves?: boolean }): Promise<DiscordMemberCheckResult> {
  const manual = options?.manual === true;
  const notifyLeaves = options?.notifyLeaves === true;
  const enabled = (await getMetaValue(env, "discord_leave_enabled")) === "1";
  const guildId = (await getMetaValue(env, "discord_leave_guild_id")).trim();
  const channelId = (await getMetaValue(env, "discord_leave_channel_id")).trim();
  const template = (await getMetaValue(env, "discord_leave_message")).trim() || "{user} ewakuował się z servera.";
  const checkedAt = nowIso();

  if (!manual && !enabled) {
    await setMeta(env, "discord_leave_status", "disabled");
    return { ok:true, baseline_created:false, current_count:0, previous_count:0, joined:[], left:[], checked_at_utc:checkedAt };
  }
  if (!env.DISCORD_BOT_TOKEN || !guildId || (notifyLeaves && !channelId)) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_status','waiting-config') ON CONFLICT(key) DO UPDATE SET value='waiting-config'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_last_check_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(checkedAt)
    ]);
    throw new Error(!guildId ? "Discord guild is not configured." : !env.DISCORD_BOT_TOKEN ? "DISCORD_BOT_TOKEN is missing in Worker secrets." : "Discord report channel is not configured.");
  }

  try {
    const members = await getDiscordGuildMembers(env, guildId);
    const current = new Map(members.map(x => [x.user_id, x]));
    const oldRows = await env.DB.prepare("SELECT user_id,username,display_name,is_bot FROM discord_member_snapshot").all<DiscordMemberSnapshot>();
    const old = oldRows.results ?? [];
    const oldMap = new Map(old.map(x => [x.user_id, x]));
    const ready = (await getMetaValue(env, "discord_leave_snapshot_ready")) === "1";
    const left = ready ? old.filter(previous => !current.has(previous.user_id) && Number(previous.is_bot) !== 1) : [];
    const joined = ready ? members.filter(member => !oldMap.has(member.user_id) && Number(member.is_bot) !== 1) : [];

    // Never turn a malformed/partial Discord response into a wall of false leave messages.
    if (ready && old.length >= 5 && left.length > Math.max(5, Math.ceil(old.length * 0.5)))
      throw new Error(`Discord snapshot safety stop: ${left.length}/${old.length} members disappeared in one poll.`);

    if (ready && notifyLeaves) {
      for (const previous of left) {
        const who = (previous.display_name || previous.username || previous.user_id).trim();
        const message = template.replace(/\{user\}/gi, who).trim();
        if (message) {
          await sendDiscordLeaveMessage(env, channelId, message);
          await setMeta(env, "discord_leave_last_user", who);
          await logCloudEvent(env, "DISCORD_LEAVE", previous.username || who, who, message);
        }
      }
    }

    const statements = [
      env.DB.prepare("DELETE FROM discord_member_snapshot"),
      ...members.map(m => env.DB.prepare(
        "INSERT INTO discord_member_snapshot(user_id,username,display_name,is_bot,last_seen_utc) VALUES(?1,?2,?3,?4,?5)"
      ).bind(m.user_id, m.username, m.display_name, m.is_bot, checkedAt)),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_snapshot_ready','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_status','ready') ON CONFLICT(key) DO UPDATE SET value='ready'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_last_check_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(checkedAt),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_last_error','') ON CONFLICT(key) DO UPDATE SET value=''"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_member_last_joined',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(joined.map(x => x.display_name || x.username || x.user_id).join(", ").slice(0,1000)),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_member_last_left',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(left.map(x => x.display_name || x.username || x.user_id).join(", ").slice(0,1000))
    ];
    await env.DB.batch(statements);

    return {
      ok: true,
      baseline_created: !ready,
      current_count: members.filter(x => Number(x.is_bot) !== 1).length,
      previous_count: ready ? old.filter(x => Number(x.is_bot) !== 1).length : 0,
      joined,
      left,
      checked_at_utc: checkedAt
    };
  } catch (e:any) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_status','error') ON CONFLICT(key) DO UPDATE SET value='error'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_last_check_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(checkedAt),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(String(e?.message ?? e).slice(0,1000))
    ]);
    throw e;
  }
}

async function pollDiscordMemberLeaves(env: Env) {
  try {
    await checkDiscordMembers(env, { manual:false, notifyLeaves:true });
  } catch {
    // Error state is persisted by checkDiscordMembers; scheduled cron should keep running.
  }
}

async function handleDiscordMemberCheck(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req, env)) return json({error:"unauthorized"},401);
  try {
    return json(await checkDiscordMembers(env, { manual:true, notifyLeaves:false }));
  } catch (e:any) {
    return json({ ok:false, error:String(e?.message ?? e), checked_at_utc:nowIso() }, 502);
  }
}


type CloudFollowerSnapshot = {
  user_id: string;
  login: string;
  display_name: string;
  followed_at: string;
};

type CloudSubscriberSnapshot = {
  user_id: string;
  login: string;
  display_name: string;
  tier: string;
};

async function listCloudFollowers(env: Env): Promise<{ total: number; rows: CloudFollowerSnapshot[] }> {
  const rows: CloudFollowerSnapshot[] = [];
  let cursor = "";
  let total = 0;

  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({
      broadcaster_id: env.TWITCH_BROADCASTER_ID,
      first: "100"
    });
    if (cursor) qs.set("after", cursor);
    const res = await twitchApi(env, `https://api.twitch.tv/helix/channels/followers?${qs.toString()}`, {}, "broadcaster");
    const text = await res.text();
    if (!res.ok) throw new Error(`Twitch followers ${res.status}: ${text.slice(0,500)}`);
    const body:any = text ? JSON.parse(text) : {};
    if (page === 0) total = Math.max(0, Number(body?.total ?? 0) || 0);
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const x of data) {
      const id = String(x?.user_id ?? "").trim();
      const login = String(x?.user_login ?? "").trim();
      if (!id && !login) continue;
      rows.push({
        user_id: id,
        login,
        display_name: String(x?.user_name ?? login ?? id).trim(),
        followed_at: String(x?.followed_at ?? "").trim()
      });
    }
    cursor = String(body?.pagination?.cursor ?? "").trim();
    if (!cursor) break;
  }

  const dedup = new Map<string, CloudFollowerSnapshot>();
  for (const row of rows) dedup.set(row.user_id || row.login.toLowerCase(), row);
  return { total: total > 0 ? total : dedup.size, rows: [...dedup.values()] };
}

async function listCloudSubscribers(env: Env): Promise<{ total: number; rows: CloudSubscriberSnapshot[] }> {
  const rows: CloudSubscriberSnapshot[] = [];
  let cursor = "";
  let total = 0;

  for (let page = 0; page < 200; page++) {
    const qs = new URLSearchParams({
      broadcaster_id: env.TWITCH_BROADCASTER_ID,
      first: "100"
    });
    if (cursor) qs.set("after", cursor);
    const res = await twitchApi(env, `https://api.twitch.tv/helix/subscriptions?${qs.toString()}`, {}, "broadcaster");
    const text = await res.text();
    if (!res.ok) throw new Error(`Twitch subscriptions ${res.status}: ${text.slice(0,500)}`);
    const body:any = text ? JSON.parse(text) : {};
    if (page === 0) total = Math.max(0, Number(body?.total ?? 0) || 0);
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const x of data) {
      const id = String(x?.user_id ?? "").trim();
      const login = String(x?.user_login ?? "").trim();
      if (!id && !login) continue;
      rows.push({
        user_id: id,
        login,
        display_name: String(x?.user_name ?? login ?? id).trim(),
        tier: String(x?.tier ?? "").trim()
      });
    }
    cursor = String(body?.pagination?.cursor ?? "").trim();
    if (!cursor) break;
  }

  const tierRank = (tier:string) => tier === "3000" ? 3 : tier === "2000" ? 2 : tier === "1000" ? 1 : 0;
  const dedup = new Map<string, CloudSubscriberSnapshot>();
  for (const row of rows) {
    // Broadcaster can appear in the subscriptions response in edge cases; YURA never counts
    // the streamer as an active subscriber in Stream Control / Stream Deck / cloud reports.
    if (row.user_id && row.user_id === env.TWITCH_BROADCASTER_ID) continue;
    const key = row.user_id || row.login.toLowerCase();
    const previous = dedup.get(key);
    if (!previous || tierRank(row.tier) > tierRank(previous.tier)) dedup.set(key, row);
  }
  return { total: dedup.size, rows: [...dedup.values()] };
}

function cloudSnapshotMap<T extends {user_id:string;login:string}>(rows: T[]) {
  return new Map(rows.map(x => [x.user_id || x.login.toLowerCase(), x]));
}

function cloudNames(rows: Array<{display_name:string;login:string}>, max = 20) {
  const names = rows.slice(0,max).map(x => x.display_name || x.login).filter(Boolean);
  const more = Math.max(0, rows.length - names.length);
  return names.join(", ") + (more > 0 ? ` +${more}` : "");
}

function tierLabel(tier: string) {
  return tier === "3000" ? "T3" : tier === "2000" ? "T2" : tier === "1000" ? "T1/Prime" : (tier || "?");
}

async function pollCloudCommunityChanges(env: Env) {
  const enabled = (await getMetaValue(env, "community_daily_enabled")) === "1";
  const followersEnabled = (await getMetaValue(env, "community_watch_followers_enabled")) !== "0";
  const subscribersEnabled = (await getMetaValue(env, "community_watch_subscribers_enabled")) !== "0";
  const channelId = (await getMetaValue(env, "community_watch_channel_id")).trim();
  const guildId = (await getMetaValue(env, "community_watch_guild_id")).trim();
  const lastRaw = await getMetaValue(env, "community_daily_last_report_utc");
  const last = lastRaw ? Date.parse(lastRaw) : 0;

  if (!enabled) {
    await setMeta(env, "community_watch_status", "disabled");
    return;
  }
  if (!channelId || !guildId || !env.DISCORD_BOT_TOKEN) {
    await setMeta(env, "community_watch_status", "waiting-config");
    return;
  }
  if (last && Date.now() - last < 24 * 3600_000)
    return;

  const checkedAt = nowIso();
  await setMeta(env, "community_watch_last_check_utc", checkedAt);

  const lines:string[] = ["📊 **Y.U.R.A. — raport dzienny**"];
  const errors:string[] = [];

  if (followersEnabled) {
    try {
      const current = await listCloudFollowers(env);
      const ready = (await getMetaValue(env, "community_followers_ready")) === "1";
      let previous: CloudFollowerSnapshot[] = [];
      try { previous = JSON.parse(await getMetaValue(env, "community_followers_snapshot_json") || "[]"); } catch { previous = []; }

      const prevMap = cloudSnapshotMap(previous);
      const curMap = cloudSnapshotMap(current.rows);
      const added = ready ? current.rows.filter(x => !prevMap.has(x.user_id || x.login.toLowerCase())) : [];
      const removed = ready ? previous.filter(x => !curMap.has(x.user_id || x.login.toLowerCase())) : [];

      if (ready && previous.length >= 10 && removed.length > Math.max(10, Math.ceil(previous.length * 0.5)))
        throw new Error(`Follower safety stop: ${removed.length}/${previous.length} disappeared in one check.`);

      for (const x of added) await logCloudEvent(env, "FOLLOW", x.login, x.display_name, "follow", 1);
      for (const x of removed) await logCloudEvent(env, "FOLLOW", x.login, x.display_name, "unfollow", -1);

      lines.push(`👁 **Followers:** \`${current.total}\`${ready ? ` • +${added.length} / -${removed.length}` : " • snapshot startowy"}`);
      if (added.length) lines.push(`↳ nowe: ${cloudNames(added, 15)}`);
      if (removed.length) lines.push(`↳ unfollow: ${cloudNames(removed, 15)}`);

      await env.DB.batch([
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_followers_snapshot_json',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(current.rows)),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_followers_ready','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_followers_total',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(current.total))
      ]);
    } catch (e:any) {
      errors.push("followers: " + String(e?.message ?? e));
      lines.push("👁 **Followers:** `BŁĄD`");
    }
  }

  if (subscribersEnabled) {
    try {
      const current = await listCloudSubscribers(env);
      const ready = (await getMetaValue(env, "community_subscribers_ready")) === "1";
      let previous: CloudSubscriberSnapshot[] = [];
      try { previous = JSON.parse(await getMetaValue(env, "community_subscribers_snapshot_json") || "[]"); } catch { previous = []; }
      previous = previous.filter(x => String(x?.user_id ?? "").trim() !== String(env.TWITCH_BROADCASTER_ID ?? "").trim());

      const prevMap = cloudSnapshotMap(previous);
      const curMap = cloudSnapshotMap(current.rows);
      const added = ready ? current.rows.filter(x => !prevMap.has(x.user_id || x.login.toLowerCase())) : [];
      const removed = ready ? previous.filter(x => !curMap.has(x.user_id || x.login.toLowerCase())) : [];
      const changed = ready ? current.rows
        .map(x => ({ current:x, previous:prevMap.get(x.user_id || x.login.toLowerCase()) }))
        .filter(x => x.previous && x.previous.tier !== x.current.tier) as Array<{current:CloudSubscriberSnapshot;previous:CloudSubscriberSnapshot}> : [];

      if (ready && previous.length >= 3 && current.rows.length === 0)
        throw new Error(`Subscriber safety stop: Twitch returned 0 while the previous snapshot had ${previous.length}.`);
      if (ready && previous.length >= 5 && removed.length > Math.max(5, Math.ceil(previous.length * 0.6)))
        throw new Error(`Subscriber safety stop: ${removed.length}/${previous.length} disappeared in one check.`);

      const t1 = current.rows.filter(x => x.tier === "1000").length;
      const t2 = current.rows.filter(x => x.tier === "2000").length;
      const t3 = current.rows.filter(x => x.tier === "3000").length;

      for (const x of added) await logCloudEvent(env, "SUBS", x.login, x.display_name, `sub ${tierLabel(x.tier)}`, 1);
      for (const x of removed) await logCloudEvent(env, "SUBS", x.login, x.display_name, `unsub ${tierLabel(x.tier)}`, -1);
      for (const x of changed) await logCloudEvent(env, "SUBS", x.current.login, x.current.display_name, `${tierLabel(x.previous.tier)} -> ${tierLabel(x.current.tier)}`, 0);

      lines.push(`⭐ **Suby:** \`${current.total}\` • T1/Prime \`${t1}\` • T2 \`${t2}\` • T3 \`${t3}\``);
      if (ready) {
        lines.push(`↳ zmiany: +${added.length} / -${removed.length}${changed.length ? ` / tier ${changed.length}` : ""}`);
        if (added.length) lines.push(`↳ nowe: ${cloudNames(added, 15)}`);
        if (removed.length) lines.push(`↳ zakończone: ${cloudNames(removed, 15)}`);
        if (changed.length) {
          const names = changed.slice(0,10).map(x => `${x.current.display_name || x.current.login} ${tierLabel(x.previous.tier)}→${tierLabel(x.current.tier)}`);
          lines.push(`↳ tier: ${names.join(", ")}${changed.length > names.length ? ` +${changed.length-names.length}` : ""}`);
        }
      } else {
        lines.push("↳ snapshot startowy");
      }

      await env.DB.batch([
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_subscribers_snapshot_json',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(current.rows)),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_subscribers_ready','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
        env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_subscribers_total',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(current.total))
      ]);
    } catch (e:any) {
      errors.push("subscribers: " + String(e?.message ?? e));
      lines.push("⭐ **Suby:** `BŁĄD`");
    }
  }

  try {
    const members = (await getDiscordGuildMembers(env, guildId)).filter(x => Number(x.is_bot) !== 1);
    const ready = (await getMetaValue(env, "community_discord_ready")) === "1";
    let previous: DiscordMemberSnapshot[] = [];
    try { previous = JSON.parse(await getMetaValue(env, "community_discord_snapshot_json") || "[]"); } catch { previous = []; }

    const oldMap = new Map(previous.map(x => [x.user_id, x]));
    const currentMap = new Map(members.map(x => [x.user_id, x]));
    const joined = ready ? members.filter(x => !oldMap.has(x.user_id)) : [];
    const left = ready ? previous.filter(x => !currentMap.has(x.user_id) && Number(x.is_bot) !== 1) : [];

    if (ready && previous.length >= 5 && left.length > Math.max(5, Math.ceil(previous.length * 0.5)))
      throw new Error(`Discord snapshot safety stop: ${left.length}/${previous.length} members disappeared in one check.`);

    lines.push(`👥 **Discord:** \`${members.length}\` osób${ready ? ` • +${joined.length} / -${left.length}` : " • snapshot startowy"}`);
    if (joined.length) lines.push(`↳ dołączyli: ${cloudNames(joined.map(x => ({display_name:x.display_name,login:x.username})), 15)}`);
    if (left.length) lines.push(`↳ odeszli: ${cloudNames(left.map(x => ({display_name:x.display_name,login:x.username})), 15)}`);

    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_discord_snapshot_json',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(members)),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_discord_ready','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_discord_total',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(members.length))
    ]);
  } catch (e:any) {
    errors.push("discord: " + String(e?.message ?? e));
    lines.push("👥 **Discord:** `BŁĄD`");
  }

  lines.push("");
  lines.push("🕒 Kolejny raport: za ~24h");

  await sendDiscordLeaveMessage(env, channelId, lines.join("\n"));

  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_daily_last_report_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(checkedAt),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_status',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(errors.length ? "partial" : "ready"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(errors.join(" | ").slice(0,1000)),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_last_change_messages','1') ON CONFLICT(key) DO UPDATE SET value='1'")
  ]);
}

async function handleBroadcasterOauthSync(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any;
  try { body = await req.json(); } catch { return json({error:"invalid json"},400); }

  const access = String(body?.access_token ?? "").trim();
  const refresh = String(body?.refresh_token ?? "").trim();
  const expiresAt = String(body?.expires_at_utc ?? "").trim();
  const clientId = String(body?.client_id ?? "").trim();
  if (!access || !refresh || !clientId) return json({error:"access_token, refresh_token and client_id are required"},400);

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO oauth_tokens(kind,access_token,refresh_token,expires_at_utc,updated_at_utc) VALUES('broadcaster',?1,?2,?3,?4)
      ON CONFLICT(kind) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at_utc=excluded.expires_at_utc,updated_at_utc=excluded.updated_at_utc`)
      .bind(access,refresh,expiresAt,nowIso()),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('oauth_broadcaster_client_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(clientId)
  ]);

  await setMeta(env,"community_watch_last_error","");
  return json({ok:true,stored:true,client_id:clientId});
}

async function handleCommunityWatchSettings(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any;
  try { body = await req.json(); } catch { return json({error:"invalid json"},400); }

  const channelId = String(body?.channelId ?? "").trim().slice(0,40);
  const guildId = String(body?.guildId ?? "").trim().slice(0,40);
  const enabled = body?.enabled !== false;
  const followersEnabled = body?.followersEnabled !== false;
  const subscribersEnabled = body?.subscribersEnabled !== false;

  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_channel_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(channelId),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_guild_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(guildId),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_daily_enabled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(enabled ? "1" : "0"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_followers_enabled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(followersEnabled ? "1" : "0"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_subscribers_enabled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(subscribersEnabled ? "1" : "0"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('community_watch_interval_hours','24') ON CONFLICT(key) DO UPDATE SET value='24'")
  ]);

  return json({ok:true, enabled, channel_id:channelId, guild_id:guildId, followers_enabled:followersEnabled, subscribers_enabled:subscribersEnabled, interval_hours:24, updated_at_utc:nowIso()});
}

async function handleDiscordMemberLeaveSettings(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any;
  try { body = await req.json(); } catch { return json({error:"invalid json"},400); }

  const guildId = String(body?.guildId ?? "").trim().slice(0,40);
  const channelId = String(body?.channelId ?? "").trim().slice(0,40);
  const message = (String(body?.message ?? "").trim() || "{user} ewakuował się z servera.").slice(0,500);
  const enabled = body?.enabled !== false;
  const previousGuild = await getMetaValue(env, "discord_leave_guild_id");
  const previousEnabled = (await getMetaValue(env, "discord_leave_enabled")) === "1";

  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_enabled',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(enabled ? "1" : "0"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_guild_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(guildId),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_channel_id',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(channelId),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_message',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(message)
  ]);

  if ((previousGuild && previousGuild !== guildId) || (!previousEnabled && enabled)) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM discord_member_snapshot"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('discord_leave_snapshot_ready','0') ON CONFLICT(key) DO UPDATE SET value='0'")
    ]);
  }

  return json({ok:true, enabled, guild_id:guildId, channel_id:channelId, updated_at_utc:nowIso()});
}

async function apiAccounts(env: Env) {
  const rows = await env.DB.prepare(`SELECT twitch_user_id,login,display_name,points,(watch_seconds+watch_seed_seconds) watch_seconds,exp,exp_stream,exp_stream_key,last_level_up_utc,last_write_utc FROM accounts ORDER BY points DESC,display_name COLLATE NOCASE`).all<any>();
  return json({ entries: rows.results, source: "yura-cloud", generated_at_utc: nowIso() });
}


// A single SQL predicate is shared by Cloud !top and website leaderboard queries.
// This list is compiled from constants, never user-supplied SQL.
const PUBLIC_LEADERBOARD_BOT_SQL = `
    AND LOWER(TRIM(COALESCE(login,''))) NOT IN (${RANKING_BOT_LOGINS.map(x => `'${x}'`).join(",")})
    AND LOWER(TRIM(COALESCE(display_name,''))) NOT IN (${RANKING_BOT_LOGINS.map(x => `'${x}'`).join(",")})
    AND LOWER(TRIM(COALESCE(login,''))) NOT LIKE '%botrix%'
    AND LOWER(TRIM(COALESCE(display_name,''))) NOT LIKE '%botrix%'`;

async function apiLeaderboardRevision(env: Env) {
  // The website checks this small token every five minutes. Bot/service accounts are excluded
  // here as well, so their point writes do not trigger a public leaderboard refresh.
  const row = await env.DB.prepare(`SELECT last_write_utc FROM accounts
    WHERE (twitch_user_id IS NULL OR (twitch_user_id<>?1 AND twitch_user_id<>?2)) ${PUBLIC_LEADERBOARD_BOT_SQL}
    ORDER BY last_write_utc DESC LIMIT 1`).bind(String(env.TWITCH_BROADCASTER_ID || ""), String(env.TWITCH_BOT_USER_ID || "")).first<any>();
  return json({ ok:true, revision:String(row?.last_write_utc ?? ""), generated_at_utc:nowIso() });
}

async function apiLeaderboard(env: Env) {
  const rows = await env.DB.prepare(`SELECT twitch_user_id,login,display_name,points,last_write_utc
    FROM accounts
    WHERE (twitch_user_id IS NULL OR (twitch_user_id<>?1 AND twitch_user_id<>?2)) AND points>0 ${PUBLIC_LEADERBOARD_BOT_SQL}
    ORDER BY points DESC,display_name COLLATE NOCASE`).bind(String(env.TWITCH_BROADCASTER_ID || ""), String(env.TWITCH_BOT_USER_ID || "")).all<any>();
  const sourceRows = (rows.results ?? []).filter((x:any) =>
    !knownBotLogin(String(x.login ?? "")) && !knownBotLogin(String(x.display_name ?? "")));
  const revision = sourceRows.reduce((latest:string, x:any) => {
    const stamp = String(x.last_write_utc ?? "");
    return stamp > latest ? stamp : latest;
  }, "");
  const entries = sourceRows.map((x:any) => ({
    login: String(x.login ?? ""),
    name: String(x.display_name || x.login || ""),
    points: Math.max(0, Number(x.points ?? 0) || 0)
  }));
  return json({ schemaVersion:3, source:"YURA Cloud", revision, updatedAt:revision || nowIso(), entries });
}


async function publicLevelRows(env: Env) {
  const blacklist = await loadExpBlacklist(env);
  const rows = await env.DB.prepare(`SELECT twitch_user_id,login,display_name,exp,last_write_utc
    FROM accounts
    WHERE twitch_user_id<>?1 AND exp>0
    ORDER BY exp DESC,display_name COLLATE NOCASE`).bind(String(env.TWITCH_BROADCASTER_ID || "")).all<any>();
  return (rows.results ?? []).filter((x:any) => {
    const login = norm(String(x?.login ?? ""));
    return login && !knownBotLogin(login) &&
      !knownBotLogin(String(x?.display_name ?? "")) &&
      String(x?.twitch_user_id ?? "") !== String(env.TWITCH_BOT_USER_ID || "") &&
      !blacklist.has(login);
  });
}

async function apiLevelsRevision(env: Env) {
  const rows = await publicLevelRows(env);
  const revision = rows.reduce((latest:string, x:any) => {
    const stamp = String(x?.last_write_utc ?? "");
    return stamp > latest ? stamp : latest;
  }, "");
  return json({ok:true,revision,generated_at_utc:nowIso()});
}

async function apiLevels(env: Env) {
  const rows = await publicLevelRows(env);
  const revision = rows.reduce((latest:string, x:any) => {
    const stamp = String(x?.last_write_utc ?? "");
    return stamp > latest ? stamp : latest;
  }, "");
  const entries = rows.map((x:any) => {
    const exp = Math.max(0, Number(x?.exp ?? 0) || 0);
    const level = tibiaLevelForExp(exp);
    const start = tibiaTotalExpForLevel(level);
    const next = tibiaTotalExpForLevel(level + 1);
    return {
      login:String(x?.login ?? ""),
      name:String(x?.display_name || x?.login || ""),
      exp,
      level,
      progress:Math.max(0,exp-start),
      target:Math.max(1,next-start),
      to_next:Math.max(0,next-exp)
    };
  });
  return json({schemaVersion:1,source:"YURA Cloud",curve:"tibia",revision,updatedAt:revision || "",generated_at_utc:nowIso(),entries});
}

// YURA v3.3.93 — long-lived rare permanent VIP jackpot, independent from points payouts.
// All percentages are expressed in percent (not fractions). 500k+ is capped.
const VIP_ALL_ODDS: ReadonlyArray<[number,number]> = [
  [1000,0.001], [5000,0.003], [10000,0.005], [25000,0.01],
  [50000,0.02], [100000,0.04], [250000,0.07], [500000,0.10]
];
function vipAllWinChancePercent(stake:number, won:boolean):number {
  if (!Number.isFinite(stake) || stake<1000) return 0;
  const upper=VIP_ALL_ODDS.findIndex(([limit])=>stake<=limit);
  let chance:number;
  if (upper<0) chance=VIP_ALL_ODDS[VIP_ALL_ODDS.length-1][1];
  else if (upper===0) chance=VIP_ALL_ODDS[0][1];
  else {
    const [start,low]=VIP_ALL_ODDS[upper-1];
    const [end,high]=VIP_ALL_ODDS[upper];
    chance=low+(high-low)*(stake-start)/(end-start);
  }
  return won ? chance : chance/10;
}
function monthKeyWarsaw(when=new Date()):string {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit'}).formatToParts(when);
  const y=parts.find(x=>x.type==='year')?.value??'0000';
  const m=parts.find(x=>x.type==='month')?.value??'01';
  return `${y}-${m}`;
}
// Must be called before the first EXP write of a month; the minute cron also calls it.
// Initially deployed mid-month, snapshots start at migration time. Never fabricate prior gains.
async function ensureMonthlyLevelProgress(env:Env):Promise<void> {
  const month=monthKeyWarsaw();
  const old=await getMetaValue(env,'levels_active_month_key');
  if (old && old!==month) {
    // Freeze completed month before a new baseline is created. Safe on repeated cron ticks.
    await env.DB.prepare(`UPDATE vip_monthly_levels SET end_exp=COALESCE(end_exp,
      (SELECT exp FROM accounts WHERE accounts.login=vip_monthly_levels.login))
      WHERE month_key=?1 AND end_exp IS NULL`).bind(old).run();
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO vip_monthly_levels(month_key,login,base_exp,created_at_utc)
    SELECT ?1,login,MAX(0,exp),?2 FROM accounts`).bind(month,nowIso()).run();
  if (old && old!==month) {
    // The prior month's EXP leader becomes a *candidate* for the current month's
    // VIP; the public status is only updated after a successful Twitch grant.
    const winner=await env.DB.prepare(`SELECT m.login,a.twitch_user_id,a.display_name,
      MAX(0,COALESCE(m.end_exp,a.exp)-m.base_exp) AS gained_exp
      FROM vip_monthly_levels m JOIN accounts a ON a.login=m.login
      LEFT JOIN vip_permanent_awards permanent ON permanent.login=m.login
      LEFT JOIN monthly_vip_exclusions ex ON ex.login=m.login
      WHERE m.month_key=?1 AND permanent.login IS NULL AND ex.login IS NULL
        AND m.base_exp IS NOT NULL AND a.twitch_user_id<>''
      ORDER BY gained_exp DESC,m.login ASC LIMIT 1`).bind(old).first<any>();
    if(winner && Number(winner.gained_exp)>0) {
      await env.DB.prepare(`INSERT OR IGNORE INTO vip_monthly_awards
        (won_month,active_month,login,twitch_user_id,display_name,gained_exp,status,created_at_utc)
        VALUES(?1,?2,?3,?4,?5,?6,'pending',?7)`)
        .bind(old,month,winner.login,winner.twitch_user_id,winner.display_name,winner.gained_exp,nowIso()).run();
    }
  }
  if (old!==month) await setMeta(env,'levels_active_month_key',month);
}
async function maybeGrantPermanentVip(env:Env,event:TwitchChatEvent,stake:number,won:boolean):Promise<void> {
  if (stake<1000 || !event.chatter_user_id || knownBotLogin(norm(event.chatter_user_login))) return;
  const badges=new Set((event.badges??[]).map(x=>x.set_id));
  if (badges.has('vip') || badges.has('moderator') || badges.has('broadcaster')) return;
  const login=norm(event.chatter_user_login);
  if (await env.DB.prepare('SELECT 1 FROM vip_permanent_awards WHERE login=?1 OR twitch_user_id=?2 LIMIT 1').bind(login,event.chatter_user_id).first()) return;
  const percent=vipAllWinChancePercent(stake,won);
  const roll=crypto.getRandomValues(new Uint32Array(1))[0]/0x100000000*100;
  if (roll>=percent) return;
  const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO vip_permanent_awards
    (login,twitch_user_id,display_name,stake,won,chance_percent,roll_percent,status,created_at_utc)
    VALUES(?1,?2,?3,?4,?5,?6,?7,'pending',?8)`)
    .bind(login,event.chatter_user_id,event.chatter_user_name||login,stake,won?1:0,percent,roll,nowIso()).run();
  if (!inserted.meta.changes) return;
  // Durable claim precedes remote grant, so retries cannot hand out duplicate wins.
  await tryGrantPendingPermanentVip(env,login);
}
async function tryGrantPendingPermanentVip(env:Env,login:string):Promise<void> {
  const row=await env.DB.prepare(`SELECT twitch_user_id,display_name,status FROM vip_permanent_awards WHERE login=?1`)
    .bind(login).first<any>();
  if (!row || row.status==='granted' || !row.twitch_user_id) return;
  try {
    const url=`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}`+
      `&user_id=${encodeURIComponent(String(row.twitch_user_id))}`;
    const res=await twitchApi(env,url,{method:'POST'},'broadcaster');
    if (res.status!==204) throw new Error(`Twitch VIP HTTP ${res.status}: ${(await res.text()).slice(0,180)}`);
    const completed=await env.DB.prepare(`UPDATE vip_permanent_awards SET status='granted',granted_at_utc=?1
       WHERE login=?2 AND status<>'granted'`).bind(nowIso(),login).run();
    if (completed.meta.changes) await sendChat(env,`👑 @${row.display_name||login} zdobywa PERMANENT VIP w !gamble all!`);
  } catch(e:any) {
    console.warn('PERMANENT VIP pending',login,String(e?.message??e));
    // The claim stays durable and can be retried after OAuth permissions are restored.
  }
}
async function attemptGrantMonthlyVip(env:Env):Promise<void> {
  const month=monthKeyWarsaw();
  const row=await env.DB.prepare(`SELECT won_month,login,twitch_user_id FROM vip_monthly_awards
    WHERE active_month=?1 AND status='pending' LIMIT 1`).bind(month).first<any>();
  if(!row) return;
  try {
    const url=`https://api.twitch.tv/helix/channels/vips?broadcaster_id=${encodeURIComponent(env.TWITCH_BROADCASTER_ID)}`+
      `&user_id=${encodeURIComponent(String(row.twitch_user_id))}`;
    const res=await twitchApi(env,url,{method:'POST'},'broadcaster');
    // 422 can mean the viewer is already VIP, but can't prove this is *our* award:
    // only 204 activates the record automatically.
    if(res.status!==204) throw new Error('monthly VIP HTTP '+res.status);
    await env.DB.prepare(`UPDATE vip_monthly_awards SET status='granted',granted_at_utc=?1
      WHERE won_month=?2 AND status='pending'`).bind(nowIso(),row.won_month).run();
  } catch(err:any){ console.warn('Monthly VIP grant pending',String(err?.message||err)); }
}
/* Public stats are opt-in via participation threshold, not authentication.
   Count-only data: no messages text, OAuth or private follower IDs. */
async function apiYuraPublicStats(env:Env):Promise<Response> {
  const minimum=10;
  const rows=await env.DB.prepare(`
    WITH counts AS (
      SELECT login,SUM(messages) messages FROM (
        SELECT login,COUNT(*) messages FROM stats_chat_messages GROUP BY login
        UNION ALL
        SELECT login,messages FROM stats_chat_baseline
      ) GROUP BY login
    ), gamble AS (
      SELECT login,
        SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) wins,
        SUM(CASE WHEN outcome='loss' THEN 1 ELSE 0 END) losses
      FROM stats_gamble_all GROUP BY login
    )
    SELECT a.login,a.display_name,a.twitch_user_id,c.messages,a.points,
      a.watch_seconds+a.watch_seed_seconds AS watch_seconds,
      COALESCE(g.wins,0) AS wins,COALESCE(g.losses,0) AS losses
    FROM accounts a JOIN counts c ON c.login=a.login
    LEFT JOIN gamble g ON g.login=a.login
    WHERE c.messages>=?1 AND a.login NOT IN (${RANKING_BOT_LOGINS.map(x=>`'${x}'`).join(',')})
    ORDER BY c.messages DESC,a.login COLLATE NOCASE ASC LIMIT 500`)
    .bind(minimum).all<any>();
  let followers=new Map<string,string>();
  let totalFollowers:number|null=null;
  try {
    const raw=await getMetaValue(env,'community_followers_snapshot_json');
    const snapshot=raw?JSON.parse(raw):[];
    if(Array.isArray(snapshot)){
      for(const row of snapshot){
        const date=String(row?.followed_at||'');
        if(!date||Number.isNaN(Date.parse(date)))continue;
        if(row?.user_id)followers.set('id:'+String(row.user_id),date);
        if(row?.login)followers.set('login:'+norm(String(row.login)),date);
      }
    }
    const countRaw=await getMetaValue(env,'community_followers_total');
    if(countRaw!=='' && Number.isFinite(Number(countRaw)))totalFollowers=Number(countRaw);
  }catch{}
  const totals=await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM stats_chat_messages)+
      (SELECT COALESCE(SUM(messages),0) FROM stats_chat_baseline) AS messages,
    (SELECT COUNT(*) FROM stats_gamble_all WHERE outcome='win') AS wins,
    (SELECT COUNT(*) FROM stats_gamble_all WHERE outcome='loss') AS losses,
    (SELECT MIN(sent_at_utc) FROM stats_chat_messages) AS first_chat`).first<any>();
  const started=await getMetaValue(env,'stats_started_at_utc');
  const stream=await getMetaValue(env,'stream_live');
  const viewers=(rows.results||[]).map((r:any)=>({
    login:String(r.login),name:String(r.display_name||r.login),
    messages:Math.max(0,Number(r.messages)||0),
    points:Math.max(0,Number(r.points)||0),
    watchSeconds:Math.max(0,Number(r.watch_seconds)||0),
    followedAt:followers.get('id:'+String(r.twitch_user_id||'')) ||
      followers.get('login:'+norm(String(r.login))) || null,
    gambleAllWins:Math.max(0,Number(r.wins)||0),
    gambleAllLosses:Math.max(0,Number(r.losses)||0)
  }));
  return json({schemaVersion:1,minMessages:minimum,updatedAt:nowIso(),
    trackedSince:started||totals?.first_chat||null,
    source:'YURA Cloud EventSub / YURA follower sync',
    channel:{messages:Math.max(0,Number(totals?.messages)||0),eligibleViewers:viewers.length,
      followers:totalFollowers,gambleAllWins:Math.max(0,Number(totals?.wins)||0),
      gambleAllLosses:Math.max(0,Number(totals?.losses)||0),
      streamLive:stream==='1'?true:stream==='0'?false:null},viewers});
}

/* Channel roles from broadcaster OAuth already stored in Y.U.R.A.
   No Twitch login or API tokens are exposed to the public website. */
let cachedChannelRoleSets: {expires:number,vips:Set<string>,moderators:Set<string>,vipStatus:string,modStatus:string,syncedAt:string} | null=null;
async function listTwitchRoleLogins(env:Env, path:string):Promise<Set<string>> {
  const result=new Set<string>();
  let after='';
  for(let page=0;page<100;page++){
    const url=new URL('https://api.twitch.tv/helix/'+path);
    url.searchParams.set('broadcaster_id',String(env.TWITCH_BROADCASTER_ID));
    url.searchParams.set('first','100');
    if(after)url.searchParams.set('after',after);
    const res=await twitchApi(env,url.toString(),{},'broadcaster');
    if(!res.ok)throw Error('Role query denied HTTP '+res.status);
    const json:any=await res.json();
    for(const row of (Array.isArray(json?.data)?json.data:[])){
      if(row?.user_login)result.add('login:'+norm(String(row.user_login)));
      if(row?.user_id)result.add('id:'+String(row.user_id));
    }
    after=String(json?.pagination?.cursor||'');
    if(!after)break;
  }
  return result;
}
async function loadChannelRoles(env:Env) {
  if(cachedChannelRoleSets && cachedChannelRoleSets.expires>Date.now()) return cachedChannelRoleSets;
  const [vip,mod]=await Promise.allSettled([
    listTwitchRoleLogins(env,'channels/vips'),
    listTwitchRoleLogins(env,'moderation/moderators')
  ]);
  const loaded={expires:Date.now()+10*60*1000,
    vips:vip.status==='fulfilled'?vip.value:new Set<string>(),
    moderators:mod.status==='fulfilled'?mod.value:new Set<string>(),
    vipStatus:vip.status==='fulfilled'?'fresh':'unavailable',
    modStatus:mod.status==='fulfilled'?'fresh':'unavailable',
    syncedAt:nowIso()};
  cachedChannelRoleSets=loaded;
  return loaded;
}

// Read-only authoritative state for the existing OBS Raffle overlay.
async function apiRaffleOverlayState(env:Env):Promise<Response>{
  const state=await getYuraRaffleState(env);
  const ends=Date.parse(String(state?.endsAtUtc||""));
  const active=!!(state?.active && Number.isFinite(ends) && ends>Date.now());
  let participants=active?(state?.entries?.length||0):0;
  let lastParticipant=active&&participants?String(state?.entries?.[participants-1]?.display||""):"";
  let stake=0;
  let pool=active?Number(state?.prize||0):0;
  if(active&&state?.mode==="jackpot"&&state.jackpotId){
    stake=Number(state.prize||0);
    const count=await env.DB.prepare(`SELECT COUNT(*) AS n FROM jackpot_entries WHERE session_id=?1`)
      .bind(state.jackpotId).first<{n:number}>();
    const last=await env.DB.prepare(`SELECT display_name FROM jackpot_entries WHERE session_id=?1 ORDER BY joined_at_utc DESC LIMIT 1`)
      .bind(state.jackpotId).first<{display_name:string}>();
    participants=Math.max(0,Number(count?.n||0));
    lastParticipant=String(last?.display_name||"");
    pool=stake*participants;
  }
  const mode=state?.mode==="single"?"SRAFFLE":state?.mode==="multi"?"RAFFLE":
    state?.mode==="auto"?"AUTORAFFLE":state?.mode==="jackpot"?"JACKPOT":"RAFFLE";
  return new Response(JSON.stringify({ok:true,active,mode,singleWinner:mode==="JACKPOT"||mode==="SRAFFLE",
    participants,lastParticipant,prize:pool,stake,
    winnerCount:state?.winnerCount||0,endsAtUtc:active?state!.endsAtUtc:null,
    durationSeconds:state?.durationSeconds||60}),
    {headers:{"Content-Type":"application/json; charset=utf-8",
      "Cache-Control":"no-store, max-age=0", "Access-Control-Allow-Origin":"*"}});
}
// Public Pokémon collection with join order and immutable reroll/purchase history.
// First-assignment dates for legacy users are explicitly marked as estimates.
async function apiPokemonCollection(env:Env):Promise<Response> {
  const rows=await env.DB.prepare(`SELECT p.twitch_user_id,p.login,
      COALESCE(NULLIF(a.display_name,''),p.login) AS display_name,
      p.pokemon_id,p.pokemon_name,p.updated_at_utc,
      j.pokemon_id AS first_pokemon_id,j.pokemon_name AS first_pokemon_name,
      j.joined_at_utc,j.estimated AS join_estimated
    FROM pokemon_profiles p
    INNER JOIN pokemon_first_assignments j ON j.twitch_user_id=p.twitch_user_id
    LEFT JOIN accounts a ON a.twitch_user_id=p.twitch_user_id
    WHERE p.pokemon_id BETWEEN 1 AND 1025
    ORDER BY j.joined_at_utc ASC,p.twitch_user_id ASC
    LIMIT 1000`).all<any>();
  const valid=(rows.results||[]).filter((r:any)=>
    /^[a-z0-9_]{2,25}$/.test(norm(String(r.login||''))) &&
    !knownBotLogin(String(r.login||'')));
  const histories=new Map<string,any[]>();
  const discovered=new Map<number,string>();
  const remember=(id:number,name:string) => {
    if(!Number.isInteger(id)||id<1||id>POKEMON_MAX_SPECIES_ID)return;
    const title=formatPokemonName(name);
    if(!discovered.has(id)||(!discovered.get(id)&&title))discovered.set(id,title);
  };
  const byId=new Map<string,any>();
  const items=valid.map((r:any,index:number)=>{
    const id=String(r.twitch_user_id||'');
    const estimated=Number(r.join_estimated||0)!==0;
    const entry:any={
      login:norm(String(r.login)),name:String(r.display_name||r.login),
      pokemonId:Number(r.pokemon_id),pokemonName:formatPokemonName(String(r.pokemon_name||'')),
      updatedAt:String(r.updated_at_utc||''),
      joinedAt:String(r.joined_at_utc||''),
      joinOrder:index+1,joinEstimated:estimated,history:[] as any[]
    };
    byId.set(id,entry);
    remember(entry.pokemonId,entry.pokemonName);
    const history:any[]=[];
    if(!estimated){
      history.push({pokemonId:Number(r.first_pokemon_id),
        pokemonName:formatPokemonName(String(r.first_pokemon_name||'')),at:String(r.joined_at_utc||''),
        type:'first',approximate:false});
      remember(Number(r.first_pokemon_id),String(r.first_pokemon_name||''));
    }
    histories.set(id,history);
    return entry;
  });
  if(items.length){
    // No event IDs, charges, OAuth tokens or user IDs enter the public payload.
    const events=await env.DB.prepare(`SELECT twitch_user_id,pokemon_id,pokemon_name,created_at_utc,event_type
      FROM (
        SELECT twitch_user_id,pokemon_id,pokemon_name,created_at_utc,
          'reroll' AS event_type FROM pokemon_rerolls
        UNION ALL
        SELECT twitch_user_id,pokemon_id,pokemon_name,created_at_utc,
          'purchase' AS event_type FROM pokemon_purchases
      )
      ORDER BY created_at_utc ASC,event_type ASC
      LIMIT 10000`).all<any>();
    for(const r of events.results||[]){
      const h=histories.get(String(r.twitch_user_id||''));
      const pokemonId=Number(r.pokemon_id);
      if(!h || !Number.isInteger(pokemonId) || pokemonId<1 || pokemonId>1025)continue;
      remember(pokemonId,String(r.pokemon_name||''));
      h.push({pokemonId,pokemonName:formatPokemonName(String(r.pokemon_name||'')),
        at:String(r.created_at_utc||''),type:String(r.event_type||'reroll'),
        approximate:false});
    }
    for(const [id,entry] of byId){
      const history=histories.get(id)||[];
      const last=history[history.length-1];
      if(!last || last.pokemonId!==entry.pokemonId){
        history.push({pokemonId:entry.pokemonId,pokemonName:entry.pokemonName,
          at:entry.updatedAt,type:'snapshot',approximate:true});
      }
      entry.history=history.slice(-60);
    }
  }
  return json({schemaVersion:3,source:'YURA Cloud',updatedAt:nowIso(),
    count:items.length,entries:items,
    discovered:[...discovered].sort((a,b)=>a[0]-b[0]).map(([pokemonId,pokemonName])=>({pokemonId,pokemonName}))});
}

// Resolve up to 20 Twitch profile pictures with a SINGLE authorized Helix call.
// Cache results at Cloudflare's edge, so public visitors do not cause repeated
// Twitch API requests. No access or refresh tokens are sent to browsers.
async function apiPublicAvatarBatch(req:Request,env:Env):Promise<Response> {
  const raw=new URL(req.url).searchParams.get('logins')||'';
  const logins=[...new Set(raw.split(',').map(norm).filter(x=>
    /^[a-z0-9_]{2,25}$/.test(x) && !knownBotLogin(x)))].sort();
  if(!logins.length || logins.length>20 || raw.length>540)
    return json({error:'Supply 1–20 Twitch logins'},400);
  const cacheUrl=new URL(req.url);
  cacheUrl.pathname='/api/avatars';
  cacheUrl.search='?logins='+encodeURIComponent(logins.join(','));
  const cacheKey=new Request(cacheUrl.toString());
  const cache=caches.default;
  try { const hit=await cache.match(cacheKey); if(hit)return hit; }catch{}
  const url=new URL('https://api.twitch.tv/helix/users');
  for(const login of logins)url.searchParams.append('login',login);
  try {
    const response=await twitchApi(env,url.toString(),{},'broadcaster');
    if(!response.ok)throw new Error('Twitch Helix HTTP '+response.status);
    const payload:any=await response.json();
    if(!Array.isArray(payload?.data))throw new Error('Twitch Helix invalid payload');
    const entries:Record<string,string>={};
    for(const person of payload.data){
      const login=norm(String(person?.login||''));
      const picture=String(person?.profile_image_url||'');
      if(!logins.includes(login))continue;
      try{
        const target=new URL(picture);
        if(target.protocol==='https:' && /(^|\.)(jtvnw\.net|twitchcdn\.net)$/.test(target.hostname.toLowerCase()))
          entries[login]=target.href;
      }catch{}
    }
    const result=new Response(JSON.stringify({source:'Twitch Helix',avatars:entries}),{
      headers:{'content-type':'application/json; charset=utf-8',
        'access-control-allow-origin':'*',
        'cache-control':'public, max-age=21600'}
    });
    try { await cache.put(cacheKey,result.clone()); }catch{}
    return result;
  }catch(err:any){
    console.warn('Profile avatar batch unavailable',String(err?.message||err));
    return json({error:'Twitch avatars temporarily unavailable'},503);
  }
}

async function apiYuraRanking(env:Env):Promise<Response> {
  await ensureMonthlyLevelProgress(env);
  await attemptGrantMonthlyVip(env);
  const month=monthKeyWarsaw();
  const roles=await loadChannelRoles(env);
  const activeVip=await env.DB.prepare(`SELECT login,display_name,won_month,active_month,status
    FROM vip_monthly_awards WHERE active_month=?1 AND status='granted' LIMIT 1`)
    .bind(month).first<any>();
  const monthlyVipLogin=norm(String(activeVip?.login||'')) ||
    (month==='2026-10'?'wielki_gekon_expiciel':'');
  const rows=await env.DB.prepare(`SELECT a.login,a.display_name,a.twitch_user_id,a.points,a.exp,
       m.base_exp, v.status permanent_vip,p.avatar_mode,p.pokemon_id,
       EXISTS(SELECT 1 FROM monthly_vip_exclusions ex WHERE ex.login=a.login) excluded
    FROM accounts a LEFT JOIN vip_monthly_levels m ON m.month_key=?1 AND m.login=a.login
    LEFT JOIN vip_permanent_awards v ON v.login=a.login
    LEFT JOIN pokemon_profiles p ON p.twitch_user_id=a.twitch_user_id AND p.twitch_user_id<>''
    WHERE a.login<>'' AND (a.twitch_user_id IS NULL OR
      (a.twitch_user_id<>?2 AND a.twitch_user_id<>?3))`)
    .bind(month,String(env.TWITCH_BROADCASTER_ID||''),String(env.TWITCH_BOT_USER_ID||'')).all<any>();
  const entries=(rows.results||[]).filter((r:any)=>!knownBotLogin(String(r.login||''))).map((r:any)=>{
    const login=norm(String(r.login||''));
    const uid=String(r.twitch_user_id||'');
    const mod=roles.modStatus==='fresh' &&
      (roles.moderators.has('login:'+login)||roles.moderators.has('id:'+uid));
    const twitchVip=roles.vipStatus==='fresh' &&
      (roles.vips.has('login:'+login)||roles.vips.has('id:'+uid));
    const monthlyHolder=login===monthlyVipLogin;
    const permanent=!!r.permanent_vip || (twitchVip && !monthlyHolder);
    const exp=Math.max(0,Number(r.exp||0));
    const base=Math.max(0,Number(r.base_exp??exp));
    const level=tibiaLevelForExp(exp),baseLevel=tibiaLevelForExp(base);
    return {login:String(r.login),name:String(r.display_name||r.login),
      points:Math.max(0,Number(r.points||0)),level,gains:Math.max(0,level-baseLevel),
      monthlyExp:Math.max(0,exp-base),baseExp:base,
      startingLevel:baseLevel,exp,
      avatarMode:r.avatar_mode==='pokemon'?'pokemon':'twitch',
      pokemonId:r.avatar_mode==='pokemon'?Number(r.pokemon_id):null,
      isPermanentVip:permanent,
      isTwitchVip:twitchVip,isModerator:mod,isManagedMonthlyVip:monthlyHolder,
      isMonthlyVipExcluded:!!r.excluded || permanent || mod};
  });
  // Historical GAINS record: compare real monthly EXP deltas from checkpoints.
  // Completed months use frozen end_exp; only the active month uses live EXP.
  // History starts when the monthly checkpoints were introduced, never before.
  const history=await env.DB.prepare(`SELECT m.login,m.month_key,
      COALESCE(NULLIF(a.display_name,''),m.login) AS display_name,
      MAX(0,COALESCE(m.end_exp,CASE WHEN m.month_key=?1 THEN a.exp ELSE NULL END)-m.base_exp) AS gain_exp
    FROM vip_monthly_levels m LEFT JOIN accounts a ON a.login=m.login
    WHERE (m.end_exp IS NOT NULL OR (m.month_key=?1 AND a.exp IS NOT NULL))
      AND (a.twitch_user_id IS NULL OR (a.twitch_user_id<>?2 AND a.twitch_user_id<>?3))
      AND m.login NOT IN (${RANKING_BOT_LOGINS.map(login=>`'${login}'`).join(',')})
      AND m.login NOT LIKE '%botrix%'
    ORDER BY gain_exp DESC,m.month_key ASC,m.login ASC LIMIT 1`)
    .bind(month,String(env.TWITCH_BROADCASTER_ID||''),String(env.TWITCH_BOT_USER_ID||'')).all<any>();
  const historicalBest=(history.results||[]).find((r:any)=>!knownBotLogin(String(r.login||'')) && Number.isFinite(Number(r.gain_exp))) || null;
  // Count only completed Twitch VIP grants from the gamble feature.
  // Pending/ungranted draws must NOT increase the public counter.
  const vipWinners=await env.DB.prepare(`SELECT COUNT(*) AS total FROM vip_permanent_awards WHERE status='granted'`).first<any>();
  const records={
    bestMonthlyGain:historicalBest ? {
      login:String(historicalBest.login),name:String(historicalBest.display_name||historicalBest.login),
      month:String(historicalBest.month_key),exp:Math.max(0,Number(historicalBest.gain_exp)||0)
    } : null,
    permanentVipWinners:Math.max(0,Number(vipWinners?.total)||0)
  };
  return json({schemaVersion:4,month,updatedAt:nowIso(),source:'YURA Cloud',records,
    twitchRoles:{status:roles.vipStatus==='fresh'&&roles.modStatus==='fresh'?'fresh':'partial',
      vips:{status:roles.vipStatus,syncedAt:roles.vipStatus==='fresh'?roles.syncedAt:null},
      moderators:{status:roles.modStatus,syncedAt:roles.modStatus==='fresh'?roles.syncedAt:null}},
    monthlyVip:{current:activeVip ? {login:activeVip.login,name:activeVip.display_name,
      wonMonth:activeVip.won_month,activeMonth:activeVip.active_month,status:'granted'}:null},
    gains:[...entries].sort((a,b)=>b.monthlyExp-a.monthlyExp||b.gains-a.gains||b.exp-a.exp||a.name.localeCompare(b.name)),
    level:[...entries].sort((a,b)=>b.level-a.level||b.exp-a.exp||a.name.localeCompare(b.name)),
    points:[...entries].sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name)),
    vipOdds:VIP_ALL_ODDS.map(([stake,chance])=>({stake,winPercent:chance,lossPercent:chance/10}))});
}

async function apiCloudRuntimeSettings(_env: Env) {
  // Deprecated compatibility endpoint. Minimal Cloud keeps these features local and
  // deliberately performs no D1 read here.
  return json({
    ok: true,
    local_only: true,
    timers_enabled: false,
    deaths_enabled: false,
    stream_events_enabled: false,
    history_enabled: false,
    timers: 0,
    updated_at_utc: null
  });
}

async function handleCloudRuntimeSettings(_req: Request, _env: Env) {
  // Older Desktop builds may still PUT this endpoint. Accept the call but do not write D1.
  return json({
    ok: true,
    local_only: true,
    timers_enabled: false,
    deaths_enabled: false,
    stream_events_enabled: false,
    history_enabled: false,
    timers: 0,
    updated_at_utc: null
  });
}

async function apiDeathState(env: Env) {
  // Tiny state used only by DEDGE/DEDGES when either command is routed through Cloud.
  // Read every counter in one D1 query so an overlay refresh remains very cheap.
  const rows = await env.DB.prepare("SELECT key,value FROM meta WHERE key IN ('death_state_ready','death_active_counter','death_count_1','death_count_2','death_count_3')").all<{key:string,value:string}>();
  const meta = new Map<string,string>((rows.results ?? []).map(x => [String(x.key), String(x.value ?? "")] as [string,string]));
  const ready = meta.get("death_state_ready") === "1";
  const active = Math.max(1,Math.min(3,Number(meta.get("death_active_counter") ?? 1)||1));
  const counts = [1,2,3].map(i => Math.max(0,Number(meta.get(`death_count_${i}`) ?? 0)||0));
  return json({ok:true,ready,active_counter:active,counts,enabled:true,command_state:true});
}

async function handleDeathState(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any;
  try { body = await req.json(); } catch { return json({error:"invalid json"},400); }
  const counts = Array.isArray(body?.counts) ? body.counts.slice(0,3).map((x:any)=>Math.max(0,Math.min(999999,Math.trunc(Number(x)||0)))) : [0,0,0];
  while (counts.length<3) counts.push(0);
  const active = Math.max(1,Math.min(3,Math.trunc(Number(body?.activeCounter ?? 1)||1)));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_state_ready','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_active_counter',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(active)),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_count_1',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(counts[0])),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_count_2',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(counts[1])),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('death_count_3',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(counts[2]))
  ]);
  return json({ok:true,ready:true,active_counter:active,counts});
}

async function pollCloudTimers(env: Env) {
  if (!await cloudFlag(env,"cloud_timers_enabled",true)) {
    await setMeta(env,"cloud_timers_status","disabled");
    return;
  }
  try {
    const live = (await getMetaValue(env,"stream_live")) === "1";
    const rows = await env.DB.prepare("SELECT id,enabled,name,message,repeat_minutes,only_when_live,min_chat_messages,chat_count,last_sent_utc,updated_at_utc FROM cloud_timers WHERE enabled=1").all<any>();
    const now = Date.now();
    for (const row of rows.results ?? []) {
      const repeatMs = Math.max(1,Number(row.repeat_minutes)||30) * 60000;
      const baseRaw = String(row.last_sent_utc || row.updated_at_utc || "");
      const base = baseRaw ? Date.parse(baseRaw) : now;
      if (Number(row.only_when_live)===1 && !live) {
        await env.DB.prepare("UPDATE cloud_timers SET last_sent_utc=?1,chat_count=0 WHERE id=?2").bind(nowIso(),String(row.id)).run();
        continue;
      }
      if (Number.isFinite(base) && now - base < repeatMs) continue;
      const chatCount = Math.max(0,Number(row.chat_count)||0);
      if (chatCount < Math.max(0,Number(row.min_chat_messages)||0)) continue;
      const message = String(row.message||"").trim();
      if (!message) continue;
      await sendChat(env,message);
      await env.DB.prepare("UPDATE cloud_timers SET last_sent_utc=?1,chat_count=0 WHERE id=?2").bind(nowIso(),String(row.id)).run();
      await logCloudEvent(env,"TIMER","","",String(row.name||row.id));
    }
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_timers_status','ready') ON CONFLICT(key) DO UPDATE SET value='ready'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_timers_last_run_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowIso()),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_timers_last_error','') ON CONFLICT(key) DO UPDATE SET value='' ")
    ]);
  } catch(e:any) {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_timers_status','error') ON CONFLICT(key) DO UPDATE SET value='error'"),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_timers_last_run_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowIso()),
      env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_timers_last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(e?.message??e).slice(0,1000))
    ]);
  }
}

async function resolveCloudStreamMetadata(env: Env, broadcasterId: string, login: string) {
  const id = String(broadcasterId || env.TWITCH_BROADCASTER_ID || "").trim();
  const userLogin = String(login || "").trim();

  const readMetadata = async (url: string) => {
    let token = await getAppAccessToken(env);
    const make = (tok: string) => fetch(url, { headers: {
      "Client-Id": env.TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${tok}`
    }});
    let res = await make(token);
    if (res.status === 401) {
      token = await getAppAccessToken(env, true);
      res = await make(token);
    }
    if (!res.ok) return { game: "", title: "" };
    const body:any = await res.json();
    const first = Array.isArray(body?.data) && body.data.length ? body.data[0] : null;
    return {
      game: first?.game_name ? String(first.game_name).trim() : "",
      title: first?.title ? String(first.title).trim() : ""
    };
  };

  // stream.online may arrive before /channels or /streams expose the fresh metadata.
  // Retry briefly inside waitUntil so Discord gets both category and title.
  let best = { game: "", title: "" };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      if (id) {
        const channel = await readMetadata(`https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(id)}`);
        if (channel.game) best.game = channel.game;
        if (channel.title) best.title = channel.title;
        if (best.game && best.title) return best;
      }
      const streamQuery = id
        ? `user_id=${encodeURIComponent(id)}`
        : userLogin ? `user_login=${encodeURIComponent(userLogin)}` : "";
      if (streamQuery) {
        const live = await readMetadata(`https://api.twitch.tv/helix/streams?${streamQuery}`);
        if (!best.game && live.game) best.game = live.game;
        if (!best.title && live.title) best.title = live.title;
        if (best.game && best.title) return best;
      }
    } catch {}
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 1000 + attempt * 750));
  }
  return best;
}

async function handleCloudStreamOnline(env: Env, event:any) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_live','1') ON CONFLICT(key) DO UPDATE SET value='1'"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_started_at_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(event?.started_at ?? nowIso())),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_stream_last_event_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowIso())
  ]);
  if (!await cloudFlag(env,"cloud_stream_events_enabled",true)) return;
  const login = String(event?.broadcaster_user_login ?? "").trim();
  const display = String(event?.broadcaster_user_name ?? login).trim();
  await logCloudEvent(env,"STREAM_ONLINE",login,display,"stream online");
  if ((await getMetaValue(env,"discord_stream_start_enabled")) !== "1") return;
  const channelId = (await getMetaValue(env,"discord_stream_channel_id")).trim();
  if (!channelId || !env.DISCORD_BOT_TOKEN) return;
  const metadata = await resolveCloudStreamMetadata(env, String(event?.broadcaster_user_id ?? ""), login);
  const game = metadata.game || "brak kategorii";
  const title = metadata.title || "";
  const url = login ? `https://www.twitch.tv/${login}` : "https://www.twitch.tv/";
  const template = (await getMetaValue(env,"discord_stream_start_message")).trim() || "🔴 **{display} JEST LIVE!**\n🎮 Wbijaj na stream: {url}";
  const hasTitlePlaceholder = /\{title\}|%title%/i.test(template);
  let message = template
    .replace(/\{display\}/gi,display||login)
    .replace(/\{login\}/gi,login)
    .replace(/\{url\}/gi,url)
    .replace(/\{game\}/gi,game)
    .replace(/%game%/gi,game)
    .replace(/\{title\}/gi,title)
    .replace(/%title%/gi,title);
  if (!hasTitlePlaceholder && title) message = message.trimEnd() + `\n📝 **${title}**`;
  await sendDiscordLeaveMessage(env,channelId,message);
}

async function handleCloudStreamOffline(env: Env, event:any) {
  // Flush the final partial presence window immediately on Twitch stream.offline.
  await flushPresenceOnStreamEnd(env);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_live','0') ON CONFLICT(key) DO UPDATE SET value='0'"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('stream_started_at_utc','') ON CONFLICT(key) DO UPDATE SET value=''"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('presence_count','0') ON CONFLICT(key) DO UPDATE SET value='0'"),
    env.DB.prepare("INSERT INTO meta(key,value) VALUES('cloud_stream_last_event_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowIso())
  ]);
  if (await cloudFlag(env,"cloud_stream_events_enabled",true))
    await logCloudEvent(env,"STREAM_OFFLINE",String(event?.broadcaster_user_login??""),String(event?.broadcaster_user_name??""),"stream offline");
}

async function apiCloudDashboard(req: Request, env: Env) {
  const url = new URL(req.url);
  const fromRaw = String(url.searchParams.get("from") || "").trim();
  const toRaw = String(url.searchParams.get("to") || nowIso());
  const metric = String(url.searchParams.get("metric") || "CHAT").toUpperCase();
  const buckets = Math.max(2,Math.min(24,Math.trunc(Number(url.searchParams.get("buckets")||7)||7)));
  const toMs = Date.parse(toRaw);
  if (!Number.isFinite(toMs)) return json({error:"invalid range"},400);

  const type = metric === "FOLLOW" ? "FOLLOW" : metric === "SUBS" ? "SUBS" : "CHAT";
  let fromMs = Date.parse(fromRaw);
  if (!fromRaw || !Number.isFinite(fromMs)) {
    const earliest = type === "CHAT"
      ? await env.DB.prepare("SELECT MIN(created_at_utc) AS t FROM cloud_events WHERE event_type='CHAT'").first<any>()
      : await env.DB.prepare("SELECT MIN(created_at_utc) AS t FROM cloud_events WHERE event_type=?1 AND amount>0").bind(type).first<any>();
    fromMs = earliest?.t ? Date.parse(String(earliest.t)) : toMs - 86400000;
  }
  if (!Number.isFinite(fromMs) || fromMs >= toMs) fromMs = toMs - 3600000;

  const rangeFrom = new Date(fromMs).toISOString();
  const rangeTo = new Date(toMs).toISOString();
  if (type !== "CHAT") {
    const rows = await env.DB.prepare("SELECT created_at_utc FROM cloud_events WHERE event_type=?1 AND amount>0 AND created_at_utc>=?2 AND created_at_utc<?3 ORDER BY created_at_utc").bind(type,rangeFrom,rangeTo).all<any>();
    const counts = Array(buckets).fill(0);
    for (const r of rows.results ?? []) {
      const t=Date.parse(String(r.created_at_utc));
      const i=Math.max(0,Math.min(buckets-1,Math.floor((t-fromMs)/(toMs-fromMs)*buckets)));
      counts[i]++;
    }
    return json({ok:true,metric:type,total:(rows.results??[]).length,trend:counts,from_utc:rangeFrom,to_utc:rangeTo});
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS messages,COUNT(DISTINCT user_login) AS chatters FROM cloud_events WHERE event_type='CHAT' AND created_at_utc>=?1 AND created_at_utc<?2").bind(rangeFrom,rangeTo).first<any>();
  const commandCount = await env.DB.prepare("SELECT COUNT(*) AS c FROM cloud_events WHERE event_type='COMMAND' AND created_at_utc>=?1 AND created_at_utc<?2").bind(rangeFrom,rangeTo).first<any>();
  const topCommands = await env.DB.prepare("SELECT detail AS label,COUNT(*) AS c FROM cloud_events WHERE event_type='COMMAND' AND created_at_utc>=?1 AND created_at_utc<?2 GROUP BY detail ORDER BY c DESC,label LIMIT 5").bind(rangeFrom,rangeTo).all<any>();
  const topChatters = await env.DB.prepare("SELECT COALESCE(NULLIF(display_name,''),user_login) AS label,COUNT(*) AS c FROM cloud_events WHERE event_type='CHAT' AND created_at_utc>=?1 AND created_at_utc<?2 GROUP BY user_login,display_name ORDER BY c DESC,label LIMIT 5").bind(rangeFrom,rangeTo).all<any>();
  const chatRows = await env.DB.prepare("SELECT created_at_utc FROM cloud_events WHERE event_type='CHAT' AND created_at_utc>=?1 AND created_at_utc<?2 ORDER BY created_at_utc").bind(rangeFrom,rangeTo).all<any>();
  const trend = Array(buckets).fill(0);
  for (const r of chatRows.results ?? []) {
    const t=Date.parse(String(r.created_at_utc));
    const i=Math.max(0,Math.min(buckets-1,Math.floor((t-fromMs)/(toMs-fromMs)*buckets)));
    trend[i]++;
  }
  return json({ok:true,metric:"CHAT",messages:Math.max(0,Number(count?.messages)||0),commands:Math.max(0,Number(commandCount?.c)||0),unique_chatters:Math.max(0,Number(count?.chatters)||0),top_commands:(topCommands.results??[]).map((x:any)=>({label:String(x.label||""),value:String(x.c||0)})),top_chatters:(topChatters.results??[]).map((x:any)=>({label:String(x.label||""),value:String(x.c||0)})),trend,from_utc:rangeFrom,to_utc:rangeTo});
}

async function requireBroadcasterToken(req: Request, env: Env) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    const res = await fetch("https://id.twitch.tv/oauth2/validate", { headers:{"Authorization":`OAuth ${token}`} });
    if (!res.ok) return false;
    const body:any = await res.json();
    return String(body?.user_id ?? "") === String(env.TWITCH_BROADCASTER_ID);
  } catch { return false; }
}

async function handleCommandSettings(req: Request, env: Env) {
  if (!await requireBroadcasterToken(req,env)) return json({error:"unauthorized"},401);
  let body:any;
  try { body = await req.json(); } catch { return json({error:"invalid json"},400); }
  const defaults = defaultCommandSettings(env);
  const previous = await loadCommandSettings(env); // Preserve Jackpot duration when older Desktop builds omit it.
  const clean:any = { masterEnabled: typeof body?.masterEnabled === "boolean" ? body.masterEnabled : true };
  clean.customCommands = Array.isArray(body?.customCommands)
    ? body.customCommands.slice(0,100).map((src:any,index:number) => ({
        id: String(src?.id ?? `custom-${index}`).slice(0,80),
        enabled: typeof src?.enabled === "boolean" ? src.enabled : true,
        aliases: normalizeAliases(src?.aliases, ""),
        message: String(src?.message ?? "").slice(0,500),
        userCooldown: Math.max(0,Math.min(3600,Math.trunc(Number(src?.userCooldown ?? 0)||0))),
        globalCooldown: Math.max(0,Math.min(3600,Math.trunc(Number(src?.globalCooldown ?? 0)||0))),
        permission: normalizePermission(src?.permission, "EVERYONE"),
        alwaysOnline: typeof src?.alwaysOnline === "boolean" ? src.alwaysOnline : true,
        streamOn: typeof src?.streamOn === "boolean" ? src.streamOn : true,
        onlyWhenLive: typeof src?.onlyWhenLive === "boolean" ? src.onlyWhenLive : false
      })).filter((x:any) => x.aliases && x.message)
    : [];
  for (const key of Object.keys(defaults)) {
    const base = defaults[key];
    const src = body?.[key] ?? {};
    clean[key] = {
      enabled: typeof src.enabled === "boolean" ? src.enabled : base.enabled,
      alwaysOnline: typeof src.alwaysOnline === "boolean" ? src.alwaysOnline : base.alwaysOnline,
      streamOn: typeof src.streamOn === "boolean" ? src.streamOn : base.streamOn,
      aliases: normalizeAliases(src.aliases,base.aliases),
      permission: normalizePermission(src.permission,base.permission),
      userCooldown: Math.max(0,Math.min(3600,Math.trunc(Number(src.userCooldown ?? base.userCooldown)||0))),
      globalCooldown: Math.max(0,Math.min(3600,Math.trunc(Number(src.globalCooldown ?? base.globalCooldown)||0)))
    };
    if (key === "gamble") {
      clean[key].winPercent = Math.max(0,Math.min(100,Number(src.winPercent ?? base.winPercent ?? 50)||0));
      clean[key].critWinPercent = Math.max(0,Math.min(100-clean[key].winPercent,Number(src.critWinPercent ?? base.critWinPercent ?? 1)||0));
    }
    if (key === "raffle" || key === "sraffle" || key === "jackpot") {
      clean[key].defaultDurationSeconds = Math.max(5,Math.min(3600,Math.trunc(Number(src.defaultDurationSeconds ?? (key === "jackpot" ? previous.jackpot?.defaultDurationSeconds : base.defaultDurationSeconds) ?? 60)||60)));
      clean[key].joinConfirmation = typeof src.joinConfirmation === "boolean" ? src.joinConfirmation : (base.joinConfirmation ?? true);
      clean[key].warning20Seconds = typeof src.warning20Seconds === "boolean" ? src.warning20Seconds : (base.warning20Seconds ?? true);
    }
  }
  await setMeta(env,"command_settings_json",JSON.stringify(clean));
  return json({ok:true,updated_at_utc:nowIso()});
}

function requireAdmin(req: Request, env: Env) {
  const header = req.headers.get("authorization") ?? "";
  return Boolean(env.ADMIN_KEY) && header === `Bearer ${env.ADMIN_KEY}`;
}

async function handleAdminImport(req: Request, env: Env) {
  if (!requireAdmin(req, env)) return json({error:"unauthorized"},401);
  const body:any = await req.json();
  const rows:any[] = Array.isArray(body?.entries) ? body.entries : [];
  const statements = rows.slice(0,5000).map(r => {
    const login = norm(String(r.login ?? ""));
    const now = nowIso();
    return env.DB.prepare(`INSERT INTO accounts(login,twitch_user_id,display_name,points,watch_seconds,watch_seed_seconds,created_at_utc,last_write_utc)
      VALUES(?1,?2,?3,?4,0,?5,?6,?6)
      ON CONFLICT(login) DO UPDATE SET twitch_user_id=CASE WHEN excluded.twitch_user_id<>'' THEN excluded.twitch_user_id ELSE accounts.twitch_user_id END,
      display_name=excluded.display_name,points=excluded.points,watch_seed_seconds=MAX(accounts.watch_seed_seconds,excluded.watch_seed_seconds),last_write_utc=excluded.last_write_utc`)
      .bind(login,String(r.twitch_user_id??""),String(r.display_name??login),Math.max(0,Math.trunc(Number(r.points??0))),Math.max(0,Math.trunc(Number(r.watch_seconds??0))),now);
  });
  if (statements.length) await env.DB.batch(statements);
  return json({ ok:true, imported:statements.length });
}


async function handleAdminOauth(req: Request, env: Env) {
  if (!requireAdmin(req, env)) return json({error:"unauthorized"},401);
  const body:any = await req.json();
  const now = nowIso();
  const stmts = [];
  for (const kind of ["bot","broadcaster"] as const) {
    const x = body?.[kind];
    if (!x) continue;
    const access = String(x.access_token ?? "");
    const refresh = String(x.refresh_token ?? "");
    if (!refresh) continue;
    const expiresAt = x.expires_at_utc ? String(x.expires_at_utc) : "";
    stmts.push(env.DB.prepare(`INSERT INTO oauth_tokens(kind,access_token,refresh_token,expires_at_utc,updated_at_utc) VALUES(?1,?2,?3,?4,?5)
      ON CONFLICT(kind) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at_utc=excluded.expires_at_utc,updated_at_utc=excluded.updated_at_utc`)
      .bind(kind,access,refresh,expiresAt,now));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ok:true,stored:stmts.length});
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type"}});
    if (url.pathname === "/health") {
      try {
        // Tiny D1 probe: unlike /api/status this does not scan application tables, but it
        // still detects quota exhaustion / D1 outages so Desktop can switch to local fallback.
        await env.DB.prepare("SELECT 1 AS ok").first();
        return json({ ok:true, service:"YURA Cloud", version:"3.3.102", mode:"minimal", message:"READY" });
      } catch (e:any) {
        return json({ ok:false, service:"YURA Cloud", version:"3.3.102", mode:"minimal", message:`D1 unavailable: ${String(e?.message ?? e)}` }, 503);
      }
    }
    if (url.pathname === "/api/status" && req.method === "GET") return json(await cloudStatus(env));
    if (url.pathname === "/api/accounts" && req.method === "GET") return apiAccounts(env);
    if (url.pathname === "/api/exp-settings" && req.method === "GET") return apiExpSettings(env);
    if (url.pathname === "/api/exp-settings" && req.method === "PUT") return handleExpSettings(req,env);
    if (url.pathname === "/api/points-blacklist" && req.method === "PUT") return handlePointsBlacklist(req,env);
    if (url.pathname === "/api/points-reset" && req.method === "POST") return handlePointsReset(req,env);
    if (url.pathname === "/api/leaderboard-revision" && req.method === "GET") return apiLeaderboardRevision(env);
    if (url.pathname === "/api/leaderboard" && req.method === "GET") return apiLeaderboard(env);
    if (url.pathname === "/api/ranking" && req.method === "GET") return apiYuraRanking(env);
    if (url.pathname === "/api/raffle/public" && req.method === "GET") return apiRaffleOverlayState(env);
    if (url.pathname === "/api/pokemon/collection" && req.method === "GET") return apiPokemonCollection(env);
    if (url.pathname === "/api/avatars" && req.method === "GET") return apiPublicAvatarBatch(req,env);
    if (url.pathname === "/api/public-stats" && req.method === "GET") return apiYuraPublicStats(env);
    if (url.pathname === "/api/levels-revision" && req.method === "GET") return apiLevelsRevision(env);
    if (url.pathname === "/api/levels" && req.method === "GET") return apiLevels(env);
    if (url.pathname === "/api/discord-member-check" && req.method === "POST") return handleDiscordMemberCheck(req,env);
    if (url.pathname === "/api/command-settings" && req.method === "PUT") return handleCommandSettings(req,env);
    if (url.pathname === "/api/discord-member-leave-settings" && req.method === "PUT") return handleDiscordMemberLeaveSettings(req,env);
    if (url.pathname === "/api/oauth-sync" && req.method === "PUT") return handleBroadcasterOauthSync(req,env);
    if (url.pathname === "/api/community-watch-settings" && req.method === "PUT") return handleCommunityWatchSettings(req,env);
    if (url.pathname === "/api/cloud-runtime-settings" && req.method === "GET") return apiCloudRuntimeSettings(env);
    if (url.pathname === "/api/cloud-runtime-settings" && req.method === "PUT") return handleCloudRuntimeSettings(req,env);
    if (url.pathname === "/api/death-state" && req.method === "GET") return apiDeathState(env);
    if (url.pathname === "/api/death-state" && req.method === "PUT") return handleDeathState(req,env);
    if (url.pathname === "/api/dashboard" && req.method === "GET") return apiCloudDashboard(req,env);
    if (url.pathname === "/api/admin/import" && req.method === "POST") return handleAdminImport(req,env);
    if (url.pathname === "/api/admin/oauth" && req.method === "POST") return handleAdminOauth(req,env);
    if (url.pathname === "/api/admin/register-eventsub" && req.method === "POST") {
      if (!requireAdmin(req,env)) return json({error:"unauthorized"},401);
      const repaired = await ensureEventSub(env, env.CLOUD_PUBLIC_URL || url.origin);
      return json(repaired, repaired.ok ? 200 : 502);
    }
    if (url.pathname === "/eventsub" && req.method === "POST") {
      const body = await req.text();
      if (!await verifyEventSub(req,env,body)) return new Response("bad signature",{status:403});
      const kind = req.headers.get("Twitch-Eventsub-Message-Type") ?? "";
      const payload:any = JSON.parse(body);
      if (kind === "webhook_callback_verification") {
        const challenge = String(payload.challenge ?? "");
        return new Response(challenge,{status:200,headers:{"content-type":"text/plain; charset=utf-8","content-length":String(enc.encode(challenge).byteLength)}});
      }
      if (kind === "revocation") {
        const subType = String(payload?.subscription?.type ?? "");
        const status = String(payload?.subscription?.status ?? "revoked");
        if (subType === "channel.chat.message")
          ctx.waitUntil(env.DB.batch([
            env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_chat_status',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(status),
            env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`revoked:${status}`)
          ]));
        return new Response("ok",{status:202});
      }
      if (kind === "notification" && payload?.subscription?.type === "channel.chat.message") {
        ctx.waitUntil((async () => {
          await setMeta(env, "eventsub_last_chat_utc", nowIso());
          await handleChatMessage(env,payload.event as TwitchChatEvent);
        })());
        return new Response("ok",{status:202});
      }
      if (kind === "notification" && payload?.subscription?.type === "stream.online") {
        ctx.waitUntil(handleCloudStreamOnline(env,payload?.event ?? {}));
        return new Response("ok",{status:202});
      }
      if (kind === "notification" && payload?.subscription?.type === "stream.offline") {
        ctx.waitUntil(handleCloudStreamOffline(env,payload?.event ?? {}));
        return new Response("ok",{status:202});
      }
      return new Response("ok",{status:202});
    }
    return json({ service:"YURA Cloud", version:"3.3.102", endpoints:["/health","/api/status","/api/accounts","/api/points-reset","/api/leaderboard-revision","/api/leaderboard","/api/levels-revision","/api/levels","/api/discord-member-check","/api/command-settings","/api/discord-member-leave-settings","/api/oauth-sync","/api/community-watch-settings","/api/cloud-runtime-settings","/api/death-state","/api/dashboard","/eventsub"] });
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      const base = (env.CLOUD_PUBLIC_URL || "").trim();
      if (base) {
        try { await ensureEventSub(env, base); }
        catch (e:any) {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_last_check_utc',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(nowIso()),
            env.DB.prepare("INSERT INTO meta(key,value) VALUES('eventsub_last_error',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(e?.message ?? e).slice(0,1000))
          ]);
        }
      }
      const scheduledAt = new Date(_controller.scheduledTime);

      // Presence is sampled each minute into one compact pending row so viewers do not
      // lose partial intervals. Account/watchtime/transaction writes flush every 10 minutes.
      await samplePresence(env, scheduledAt.getUTCMinutes() % PRESENCE_INTERVAL_MINUTES === 0);
      await warnYuraRaffleIfDue(env);
      await finishYuraRaffleIfDue(env);
      await recoverJackpots(env);
      await ensureMonthlyLevelProgress(env);
      if (scheduledAt.getUTCMinutes() === 0) {
        const pending=await env.DB.prepare(`SELECT login FROM vip_permanent_awards WHERE status='pending' ORDER BY created_at_utc LIMIT 5`).all<{login:string}>();
        for (const row of pending.results||[]) await tryGrantPendingPermanentVip(env,row.login);
      }

      // One automatic social job only: a combined Followers + Subs + Discord report.
      // Evaluate only on the top of each UTC hour; the report itself is guarded to once / 24h.
      if (scheduledAt.getUTCMinutes() === 0)
        await pollCloudCommunityChanges(env);
    })());
  }
};
