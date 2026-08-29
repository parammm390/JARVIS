#!/usr/bin/env bash
set -Eeuo pipefail

release_sha="__FINNOR_RELEASE_SHA__"
build_id="__FINNOR_BUILD_ID__"
version="__FINNOR_VERSION__"
release_source="__FINNOR_RELEASE_SOURCE__"
repository="__FINNOR_REPOSITORY__"
unit_name="__FINNOR_SYSTEMD_UNIT__"
release_root="__FINNOR_RELEASE_ROOT__"
current_link="__FINNOR_CURRENT_SYMLINK__"
secret_env="__FINNOR_SECRET_ENV__"
release_env="__FINNOR_RELEASE_ENV__"
sse_port="__FINNOR_SSE_PORT__"
sse_hostname="__FINNOR_SSE_HOSTNAME__"

[[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]
remote_main=$(git ls-remote "https://github.com/${repository}.git" refs/heads/main | awk '{print $1}')
test "$remote_main" = "$release_sha"
test -r "$secret_env"

install -d -o finnor -g finnor -m 0755 "$release_root"
release_dir="${release_root}/${release_sha}"
staging_dir="${release_root}/.staging-${release_sha}"

if [ ! -d "${release_dir}/.git" ]; then
  rm -rf "$staging_dir"
  sudo -u finnor git clone --quiet --filter=blob:none --no-checkout "https://github.com/${repository}.git" "$staging_dir"
  sudo -u finnor git -C "$staging_dir" fetch --quiet origin "$release_sha"
  sudo -u finnor git -C "$staging_dir" checkout --quiet --detach "$release_sha"
  test "$(sudo -u finnor git -C "$staging_dir" rev-parse HEAD)" = "$release_sha"
  test -z "$(sudo -u finnor git -C "$staging_dir" status --porcelain=v1 --untracked-files=all)"
  sudo -u finnor bash -lc "cd '$staging_dir/finnor-os' && npm ci --no-audit --no-fund"
  mv "$staging_dir" "$release_dir"
else
  test "$(sudo -u finnor git -C "$release_dir" rev-parse HEAD)" = "$release_sha"
  test -z "$(sudo -u finnor git -C "$release_dir" status --porcelain=v1 --untracked-files=all)"
fi

release_env_tmp=$(mktemp)
unit_tmp=$(mktemp)
verify_tmp=$(mktemp)
previous_release_env=$(mktemp)
next_link="${current_link}.next"
previous_target=$(readlink "$current_link" 2>/dev/null || true)
previous_release_env_exists=0
release_env_written=0
switched=0

if [ -f "$release_env" ]; then
  cp "$release_env" "$previous_release_env"
  previous_release_env_exists=1
fi

rollback() {
  status=$?
  if [ "$status" -ne 0 ]; then
    # Release identity and source must roll back as one unit. Leaving the new
    # release.env beside the previous checkout makes an old worker advertise the
    # new SHA and migration identity, which defeats canonical readiness checks.
    if [ "$release_env_written" -eq 1 ]; then
      if [ "$previous_release_env_exists" -eq 1 ]; then
        install -o root -g finnor -m 0644 "$previous_release_env" "$release_env"
      else
        rm -f "$release_env"
      fi
    fi
    if [ "$switched" -eq 1 ]; then
      if [ -n "$previous_target" ]; then
        ln -sfn "$previous_target" "$next_link"
        mv -Tf "$next_link" "$current_link"
        systemctl restart "$unit_name" || true
      else
        systemctl stop "$unit_name" || true
        rm -f "$current_link"
      fi
    fi
  fi
  rm -f "$release_env_tmp" "$unit_tmp" "$verify_tmp" "$previous_release_env" "$next_link"
  exit "$status"
}
trap rollback EXIT

cat >"$release_env_tmp" <<EOF
FINNOR_COMMIT_SHA=$release_sha
FINNOR_BUILD_ID=$build_id
FINNOR_VERSION=$version
FINNOR_ENVIRONMENT=production
FINNOR_RELEASE_SOURCE=$release_source
FINNOR_WORKER_CAPABILITIES=jobs,orchestration,computer,event-wake,connection-health,realtime,sse
FINNOR_SSE_GATEWAY_ENABLED=1
# Two slots with one interactive reservation prevent long Objective jobs from
# occupying the entire worker process. Release-owned values override stale
# machine secrets and make this capacity contract deterministic.
WORKER_CONCURRENCY=2
WORKER_INTERACTIVE_RESERVED_CONCURRENCY=1
SSE_PORT=$sse_port
JARVIS_SSE_ALLOWED_ORIGINS=https://finnorai.com
# The embedded worker also owns the operational SSE gateway.
PORT=$sse_port
EOF
install -o root -g finnor -m 0644 "$release_env_tmp" "$release_env"
release_env_written=1

cat >"$unit_tmp" <<EOF
[Unit]
Description=FINNOR production worker and embedded orchestrator
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=10

[Service]
Type=simple
User=finnor
Group=finnor
WorkingDirectory=$current_link/finnor-os
Environment=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin
Environment=DOTENV_CONFIG_PATH=$secret_env
EnvironmentFile=$release_env
ExecStart=/opt/node/bin/node $current_link/finnor-os/node_modules/tsx/dist/cli.mjs apps/worker/src/index.ts
Restart=always
RestartSec=10
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
UMask=0077
StandardOutput=journal
StandardError=journal
SyslogIdentifier=finnor-worker

[Install]
WantedBy=multi-user.target
EOF
install -o root -g root -m 0644 "$unit_tmp" "/etc/systemd/system/$unit_name"

# systemd-analyze loads host units too. Production already hit an unrelated
# snapd.service diagnostic (unsupported RestartMode) which made this command exit
# non-zero under `set -e` before FINNOR ever switched/restarted the worker. Keep
# host diagnostics visible, but fail only when the diagnostic points at FINNOR's
# own unit/path. This preserves a strict unit gate without coupling deployment to
# arbitrary distro-package warnings.
if ! systemd-analyze verify "/etc/systemd/system/$unit_name" >"$verify_tmp" 2>&1; then
  cat "$verify_tmp" >&2
  if grep -Fq "$unit_name" "$verify_tmp" || grep -Fq "/etc/systemd/system/$unit_name" "$verify_tmp"; then
    echo "FINNOR systemd unit failed verification" >&2
    exit 1
  fi
  echo "systemd-analyze reported only unrelated host-unit diagnostics; continuing" >&2
fi
rm -f "$verify_tmp"
verify_tmp=""

ln -sfn "$release_dir" "$next_link"
mv -Tf "$next_link" "$current_link"
switched=1
systemctl daemon-reload
systemctl enable "$unit_name" >/dev/null
systemctl restart "$unit_name"

for _ in $(seq 1 30); do
  if systemctl is-active --quiet "$unit_name"; then
    main_pid=$(systemctl show "$unit_name" -p MainPID --value)
    if [ "${main_pid:-0}" -gt 0 ]; then break; fi
  fi
  sleep 2
done
systemctl is-active --quiet "$unit_name"
test "$(readlink -f "$current_link")" = "$release_dir"
systemctl show "$unit_name" -p ExecStart -p WorkingDirectory --value | grep -q "$current_link"
if journalctl -u "$unit_name" --since "5 minutes ago" --no-pager -o cat | grep -Eqi 'run loop crashed|refused to boot|fatal'; then
  echo "worker emitted a fatal startup error" >&2
  exit 1
fi

health_file=$(mktemp)
for _ in $(seq 1 30); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:${sse_port}/healthz" >"$health_file"; then break; fi
  sleep 2
done
node -e 'const fs=require("fs");const h=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));if(!h.ok||!h.realtime||h.release.commitSha!==process.argv[1])process.exit(1)' "$release_sha" "$health_file"
rm -f "$health_file"

# Public SSE ingress is HTTPS-only. Azure DNS/NSG are configured by the guarded
# release workflow before this runs; this host terminates TLS and proxies the
# authenticated stream to the worker's loopback port.
if ! command -v nginx >/dev/null 2>&1 || ! command -v certbot >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx certbot python3-certbot-nginx
fi
cat > /etc/nginx/sites-available/finnor-sse <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name $sse_hostname;
  location / {
    proxy_pass http://127.0.0.1:$sse_port;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header Authorization \$http_authorization;
    proxy_set_header Last-Event-ID \$http_last_event_id;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
  }
}
EOF
ln -sfn /etc/nginx/sites-available/finnor-sse /etc/nginx/sites-enabled/finnor-sse
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx
certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email --redirect -d "$sse_hostname"
# Validate TLS, SNI, nginx, and the worker without relying on Azure public-IP
# hairpin routing. The GitHub runner performs the independent public check in
# verify-production-parity immediately after this command returns.
curl --fail --silent --max-time 15 --noproxy "*" --resolve "${sse_hostname}:443:127.0.0.1" "https://${sse_hostname}/healthz" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const h=JSON.parse(s);if(!h.ok||!h.realtime||h.release.commitSha!==process.argv[1])process.exit(1)})' "$release_sha"

switched=0
echo "FINNOR_AZURE_DEPLOY_OK $release_sha"
