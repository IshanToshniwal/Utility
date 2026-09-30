# StaffHub — Discord staff-utility bot

Manages your **staff team** across two servers: the **main server** (where members apply)
and the **staff server** (where the team lives). Applications → verification → roster →
promotions → strikes → breaks, with roles and `[Position | Name]` nicknames kept in sync in
**both** servers, plus an **admin-only web dashboard**. Runs on Render's free tier.

## How it flows

1. Admin links the servers: `/link setup staff_server:<id>` in the main server.
2. Admin builds the **roster** on the dashboard: departments (Moderation, Events…) with ordered
   positions (Trial Mod → Moderator → Senior Mod), each mapped to a role in the main server and a
   role in the staff server.
3. A member runs **`/apply`** in the main server → form → lands in the staff server's applications
   channel with **Accept / Deny** buttons.
4. **Accept** → the applicant is DMed the staff-server invite. When they join they get the Pending
   role and are asked to post their **proof** in the proof channel.
5. The applicant posts their proof (image) in the **proof channel** (or uses `/proof`) → it appears
   in the **verification channel** with a **position dropdown** (= approve) and a **Deny** button.
   Approving adds them to the roster, gives the position role + Staff role in both servers, sets the
   nickname to `[Tag | Name]` everywhere (the *tag* is the short nickname you set per position, e.g.
   `Mod`), posts **"New staff member"** in announcements, pings them in the **guide channel** with an
   editable guide (position, nickname, their staff channels, how to use `/break` and `/bye`), updates
   the **live roster message**, and DMs them. `/verify` still exists for manual overrides.
6. `/staff promote` / `/staff demote` / `/staff set` move them along the roster and swap roles.
7. `/staff strike` — strikes with a limit (alert managers, auto-demote or remove).
8. `/break` (staff request → manager approves) or `/loa give` — LOA role in both servers,
   removed automatically when the break ends. `/active breaks` shows who is away.
9. `/bye` — the member resigns; roster updated, roles + nickname removed in both servers, farewell post.

## Commands

| Command | Who | What |
|---|---|---|
| `/link setup staff_server:<id>` · `view` · `unlink` | Admin (main server) | Connect the two servers |
| `/setup channel/manager/role/department/position/invite/view` | Admin | Quick config (the dashboard does all of it too) |
| `/apply` | Members (main server) | Staff application form |
| `/proof image [note]` | Accepted applicants (staff server) | Send verification proof (or just post it in the proof channel) |
| `/verify @user position [proof] [notes]` | Managers | Manual verification (override) |
| `/staff roster` | Everyone | Roster by department |
| `/staff record [@user]` | Self / managers | Strikes + history |
| `/staff promote @user [to]` · `demote` · `set @user position` | Managers | Move along the roster |
| `/staff strike @user reason` · `unstrike @user #` | Managers | Strikes |
| `/staff remove @user [reason]` | Managers | Remove from the team |
| `/staff sync [@user]` | Managers | Re-apply roles/nicknames from the roster |
| `/break duration reason` | Staff | Request time off |
| `/loa give @user duration reason` · `end @user` | Managers | Give / end a break |
| `/active breaks` | Everyone | Who is on a break now |
| `/bye [message]` | Staff | Resign |
| `/help` | Everyone | |

**Managers** = Administrators, plus any *manager roles* you pick (staff server).

## Dashboard (Administrators only)

Login with Discord at the bot's URL. Anyone with **Administrator** in the main or staff server can:
- **Overview** — counts, setup checklist, activity feed
- **Roster** — create departments and positions, nickname tag per position, pick the main-server and staff-server role for each, reorder, post/refresh the live roster message
- **Staff** — search, records, strikes, move/promote/demote, LOA, notes, remove, add existing staff
- **Applications** — review with Accept/Deny, edit the 5 questions, set the invite link
- **Verification** — proof requests with the image, approve as a position or deny with a reason
- **Breaks** — approve requests, end breaks, give LOA
- **Settings** — every channel (applications, proof, verification, announcements, guide, roster, strikes, breaks, log, main-server post), manager roles, Staff/LOA/Pending roles, nickname format, strike limit and action, require-application toggle, **all message templates** (guide, announcement, DMs), unlink

### Channels (all in the staff server)
| Channel | What lands there |
|---|---|
| Applications | `/apply` submissions with Accept / Deny |
| Proof | accepted applicants post their proof image here |
| Verification | proof requests with position dropdown + Deny (managers) |
| Announcements | new staff, promotions, transfers, farewells |
| Guide | the new staff member is pinged with the guide |
| Roster | one live roster message, edited automatically |
| Strikes | strikes, removals, limit alerts |
| Breaks | break requests with Approve / Deny, LOA start/end |
| General log | verifications, demotions, everything else — and the fallback for any channel left unset |
| Main server post | optional public "welcome our new staff member" in the main server |

## 1. Discord application

1. <https://discord.com/developers/applications> → **New Application** → **Bot** → **Reset Token** (`DISCORD_TOKEN`).
2. **Privileged Gateway Intents** → enable **Server Members Intent** and **Message Content Intent** (needed to see proof images posted in the proof channel).
3. **General Information** → copy **Application ID** (`CLIENT_ID`).
4. **OAuth2** → copy **Client Secret** (`CLIENT_SECRET`) and add redirect `https://<service>.onrender.com/auth/callback`.
5. Invite the bot to **both** servers (scopes `bot` + `applications.commands`; permissions
   **Manage Roles, Manage Nicknames, Create Invite, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Add Reactions**):
   `https://discord.com/oauth2/authorize?client_id=YOUR_ID&scope=bot%20applications.commands&permissions=402771009`
6. In both servers move the bot's role **above** every staff/position/LOA role.

## 2. Deploy on Render

1. Push this folder to GitHub (or paste the files with the `/` trick).
2. <https://render.com> → **New → Web Service** → connect the repo. `render.yaml` sets build
   `npm install && npm run deploy` and start `npm start`.
3. Environment variables: `DISCORD_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET`, `SESSION_SECRET` (any long
   random string), and storage: `DATABASE_URL` (Postgres, e.g. Neon) **or** `DATA_CHANNEL_ID` (private
   channel the bot backs up to). Optional `GUILD_IDS=mainId,staffId` for instant commands while testing.
4. UptimeRobot HTTP monitor on `https://<service>.onrender.com/health` every 5 minutes.

## 3. First-time setup

```
/link setup staff_server:123456789012345678      (in the main server)
```
Then open the dashboard → **Roster** (departments + positions with roles) → **Settings**
(channels, manager roles, Staff/LOA roles). Or with commands:
```
/setup channel type:Applications channel:#applications        (in the staff server)
/setup channel type:Staff announcements channel:#staff-news
/setup channel type:Staff log channel:#staff-log
/setup channel type:Breaks channel:#breaks
/setup channel type:Proof channel:#proof
/setup channel type:Verification channel:#verification
/setup channel type:Guide channel:#welcome-staff
/setup channel type:Roster channel:#roster
/setup manager role:@Manager
/setup role type:Staff role:@Staff        (run once in each server)
/setup role type:LOA role:@LOA            (run once in each server)
/setup department name:Moderation
/setup position department:Moderation name:Trial Mod role:@Trial Mod nickname:T-Mod   (run in each server, lowest rank first)
```

## Run locally
```bash
npm install
cp .env.example .env   # fill in
npm run deploy && npm start
```
