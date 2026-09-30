# Windows lab deployment

This guide exposes one Fracto UI URL to browsers on a trusted lab network. Nginx
runs on the Windows host and proxies HTTP traffic to Fracto's loopback-only
Docker ports. The lab profile disables application authentication to support
shared feature development. It is not a public deployment profile; keep the
production EC2 configuration and its required OIDC authentication separate.

## Request layout

Lab browsers open `http://<lab-host-ip>:3000/`. Nginx serves as the single LAN
entry point and sends `/api/main/`, `/api/data/`, `/api/asset/`, `/api/tiles/`,
and `/api/admin/` to the matching Fracto services on `127.0.0.1:3001` through
`127.0.0.1:3005`. Other paths go to the UI on `127.0.0.1:3006`. The API
prefixes are removed before forwarding. See
[`nginx/fracto-lab.conf.example`](nginx/fracto-lab.conf.example).

Compose should continue publishing Fracto's ports only on loopback. Nginx can
reach them on the host, while lab clients reach only the proxy port. Fracto's
UI recognizes port `3000` as a proxied deployment and uses same-origin `/api/`
paths, so the browser does not connect directly to the service ports.

## Lab-only environment

In the lab server's ignored root `.env`, set the following values. Replace the
example address with the lab host's stable LAN address:

```dotenv
FRACTO_AUTH_MODE=none
FRACTO_AUTH_REQUIRED=false
FRACTO_ADMIN_READONLY_BYPASS=true
FRACTO_UI_ORIGIN=http://10.0.0.98:3000
```

`FRACTO_AUTH_MODE=none` selects bypass mode; no Google OIDC redirect is used.
These settings are for an isolated development lab only. Do not copy them to a
public deployment or commit the lab `.env` file. The GET-view bypass makes the
commits, logs, versions, social, and Reference pages available without sign-in.
Some GET handlers refresh local snapshots or diagnostic files. User lists,
login audit events, and all write operations remain protected by their
enabled-admin checks.

Recreate the application container with the same Compose files and overlays
used by this installation so it receives the updated environment. For the
base Compose file alone, run this from the repository root in PowerShell:

```powershell
docker compose -f .\compose.yaml up -d --force-recreate fracto
```

If this host uses another Compose overlay, include it in the command as well;
do not omit a tile-source or other deployment overlay when recreating the
container.

## Configure Nginx on Windows

1. Copy `deploy/nginx/fracto-lab.conf.example` into the Nginx installation's
   `conf` directory, for example as `conf/fracto-lab.conf`.
2. In the existing `conf/nginx.conf`, add this line inside its `http {}` block
   if it does not already include the lab file:

   ```nginx
   include conf/fracto-lab.conf;
   ```

   Do not create a new `nginx.conf` under the Fracto repository. Nginx uses the
   configuration beneath its own installation directory unless started with
   an explicit prefix or configuration path.
3. From the Nginx installation directory, validate the full configuration:

   ```powershell
   .\nginx.exe -t
   ```

4. If Nginx is not already running, start it from that directory with
   `.\nginx.exe`. If it is running, reload it with
   `.\nginx.exe -s reload`. A reload requires a running Nginx master using
   this installation's configuration.

The example listens on port `3000` on all interfaces. If another application
already uses that port, choose an unused port and update both the Nginx
`listen` directive and `FRACTO_UI_ORIGIN` accordingly. Keep the UI proxy port
different from `3006` and `3106`, which Fracto reserves for direct-port UI
operation.

## Restrict network access

Allow inbound TCP on the proxy port only from the trusted lab subnet. Replace
the example CIDR with the actual subnet used at the site; do not assume every
`10.0.0.x` network uses `/24`.

```powershell
New-NetFirewallRule -DisplayName "Fracto lab Nginx" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3000 `
  -RemoteAddress 10.0.0.0/24 -Profile Private
```

Do not create LAN firewall rules for Fracto ports `3001–3006`. Keep the
Windows network profile and allowed remote subnet aligned with the site's
network policy. This HTTP, authentication-bypass profile is intended only for
a trusted, isolated development network.

## Verify access

On the Windows host, test the UI and one routed API:

```powershell
curl.exe --noproxy "*" -i http://127.0.0.1:3000/
curl.exe --noproxy "*" -i http://127.0.0.1:3000/api/admin/ports
```

The first request should return the UI HTML. The second should return the
runtime port map as JSON. Then, from a different lab computer, test the proxy
port and open the same address in a browser:

```powershell
Test-NetConnection 10.0.0.98 -Port 3000
```

Use `http://10.0.0.98:3000/` in the browser, replacing the IP with the host's
stable LAN address. If the host-local requests pass but the remote test fails,
check the Windows Firewall rule, the active network profile, and the lab
subnet. If `curl` reports connection refused on the host, verify that Nginx is
running and that no other server block has conflicting listeners.

## Production separation

The lab HTTP listener and bypass settings must remain confined to the lab
network. Public deployments use their own HTTPS proxy, OIDC credentials,
callback URI, secure cookies, and `FRACTO_AUTH_REQUIRED=true`; see
[`README.md`](README.md) for the production EC2 procedure. Google sign-in on a
non-localhost address requires HTTPS and a registered hostname, so re-enabling
OIDC for browsers on the lab LAN requires a separate hostname and TLS setup.
