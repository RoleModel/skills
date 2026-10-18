---
name: cloudflare-tunnel
description: >-
  Expose locally-running apps to stable public HTTPS URLs using a single
  per-developer Cloudflare Tunnel (cloudflared). Use whenever you need an
  external service to reach your local dev server — receiving webhooks (Box,
  Stripe, GitHub, Twilio, etc.), testing OAuth callbacks, sharing a
  work-in-progress with a teammate, or previewing on a real device. Also use
  when the user mentions cloudflared, "tunnel", "trycloudflare", "public URL for
  localhost", "webhook can't reach my machine", or asks how to route a domain to
  their local port.
allowed-tools: Bash Read Edit Write
compatibility: Designed for Claude Code (or similar products)
metadata:
  author: rolemodel
  version: "1.0"
  triggers: "cloudflared, cloudflare tunnel, trycloudflare, tunnel, public URL for localhost, webhook can't reach my machine, route domain to local port"
license: MIT
---

# Cloudflare Tunnel

Route public hostnames on a Cloudflare-managed domain to apps running on
`localhost`. A **named tunnel** gives stable hostnames that survive restarts —
register them with external services once and forget them. This is the right
choice for webhook development, where re-registering a URL every session is
painful.

(If you only need a throwaway URL for a single session and don't own a
Cloudflare domain, `cloudflared tunnel --url http://localhost:<port>` prints a
random `*.trycloudflare.com` URL with no account or config needed. The rest of
this skill covers the named-tunnel setup, which is what you want for anything
recurring.)

## One tunnel per developer

Run a **single tunnel named after yourself** (`<username>`) and route every
project through it. A tunnel isn't tied to one app — its `ingress` list maps
many hostnames to many local ports, and one `cloudflared` process serves them
all. This keeps setup to one login, one credentials file, one config, and one
running process no matter how many projects you work on.

Give each project a hostname suffixed with your username so they never collide
with another developer's. Keep it a single label (`<app>--<username>`, not
`<app>.<username>`) — a nested subdomain adds a DNS level that a one-level
wildcard cert won't cover:

- Tunnel name: `<username>` (e.g. `jdoe`)
- Hostname per project: `<app>--<username>.<your-domain>`
  (e.g. `my-app--jdoe.example.com`, `other-app--jdoe.example.com`)

Substitute your real username, app slugs, and Cloudflare domain throughout.

## Prerequisites

- `cloudflared` installed (`brew install cloudflared` on macOS).
- A domain managed in the team's Cloudflare account (the DNS route step writes a
  CNAME into that zone).
- Credentials to authorize that domain during `cloudflared tunnel login`.

## 1. Log in (one-time per machine)

```bash
cloudflared tunnel login
```

This opens a browser. Authenticate with the account that manages the domain and
authorize the domain you'll route to. It writes a `cert.pem` into
`~/.cloudflared/`.

## 2. Create the tunnel (one-time per developer)

```bash
cloudflared tunnel create <username>
```

This provisions the tunnel and writes a credentials file
`~/.cloudflared/<TUNNEL-ID>.json`. You do this once — every project reuses this
same tunnel.

## 3. Route a hostname for each project

Run this once per project, all pointing at your one tunnel:

```bash
cloudflared tunnel route dns <username> <app>--<username>.<your-domain>
```

## 4. Write the config file

One `~/.cloudflared/config.yml` holds an ingress rule per project. Look up the
tunnel ID first:

```bash
cloudflared tunnel list | awk '$2 == "<username>" { print $1 }'   # the ID
```

```yaml
tunnel: <tunnel-id>
credentials-file: /Users/<username>/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: <app>--<username>.<your-domain>
    service: http://localhost:3000        # this project's port
  - hostname: <other-app>--<username>.<your-domain>
    service: http://localhost:3001        # another project's port
  - service: http_status:404              # catch-all; required last rule
```

The final catch-all `http_status:404` rule is mandatory — `cloudflared` rejects
a config whose last ingress rule has a `hostname`.

Keep `credentials-file` in sync with the ID from `tunnel list`. If you ever
delete and recreate the tunnel, the ID changes and this line must be updated —
a stale ID here points at a tunnel that no longer exists, so `cloudflared` fails
to start and no routes appear in the Cloudflare UI.

## 5. Allow the hosts in each app (framework-dependent)

Web frameworks reject requests whose `Host` header isn't in an allowlist, so a
tunneled request 403s until you permit the domain. In a Rails app, add a regex
covering the whole domain to `config/environments/development.rb` so every
project's hostname is accepted without editing config per app:

```ruby
config.hosts << /\A.*\.<your-domain-escaped>\z/   # e.g. /\A.*\.example\.com\z/
```

Other frameworks have an equivalent (Vite's `server.allowedHosts`, Next.js
`allowedDevOrigins`, Django's `ALLOWED_HOSTS`, etc.) — set it there instead.

## 6. Install as a service

Rather than babysitting `cloudflared tunnel run` in a foreground terminal,
install it as a background service so the tunnel is always up and reconnects on
its own — you never have to remember to start it before your app.

On macOS, install it as a per-user **launch agent** (starts at login, reads your
existing `~/.cloudflared/config.yml` — no `sudo`, no root):

```bash
cloudflared service install
```

**Verify the generated plist actually runs the tunnel.** Some `cloudflared`
versions write a launch agent whose `ProgramArguments` is only the binary path
with no subcommand, so launchd runs a bare `cloudflared`, which exits with
*"use `cloudflared tunnel run` to start tunnel <name>"* and then crash-loops via
`KeepAlive`. Check `~/Library/LaunchAgents/com.cloudflare.cloudflared.plist`; if
`ProgramArguments` lacks a `tunnel`/`run` entry, fix it to:

```xml
<key>ProgramArguments</key>
<array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>--no-autoupdate</string>
    <string>--config</string>
    <string>/Users/<username>/.cloudflared/config.yml</string>
    <string>tunnel</string>
    <string>run</string>
</array>
```

then reload it: `launchctl unload <plist> && launchctl load <plist>`.

Manage the agent through launchd (user domain — no `sudo`), and reload it after
any `config.yml` change:

```bash
launchctl list | grep cloudflared        # col 1 = PID (running), col 2 = last exit code
launchctl unload ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist   # stop
launchctl load   ~/Library/LaunchAgents/com.cloudflare.cloudflared.plist   # start
cloudflared service uninstall            # remove the service
```

`cloudflared` logs everything (including `INF` lines) to **stderr**, so watch
`~/Library/Logs/com.cloudflare.cloudflared.err.log` — look for `Registered
tunnel connection` on success. Then confirm routing end to end:

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" https://<app>--<username>.<your-domain>/
```

(`sudo cloudflared service install` instead installs a boot-time launch *daemon*
that reads config from `/etc/cloudflared/`, logs to `/Library/Logs/`, and is
managed with `sudo launchctl`. The login agent above is the better fit for a dev
machine — it runs as you and uses the config you already set up.)

## Adding another project later

No new tunnel needed — reuse the one you have:

1. `cloudflared tunnel route dns <username> <new-app>--<username>.<your-domain>`
2. Add an `ingress` rule mapping that hostname to the new project's port.
3. Restart the service to pick up the config change:
   `launchctl stop com.cloudflare.cloudflared && launchctl start com.cloudflare.cloudflared`
