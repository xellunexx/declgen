#!/usr/bin/env bash
# declgen keep-alive watchdog: restarts web server + quick tunnel if either dies.
# If the tunnel restarts, the trycloudflare URL changes -> wan.json + current_url.txt are updated.
cd "$(dirname "$0")/../.." || exit 1
# single-instance guard: never run two watchdogs (cron/manual double-start safe)
PIDFILE=web/run/watchdog.pid
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$PIDFILE"
PORT=48913
SLOG=web/run/server.log
TLOG=web/run/tunnel.log
WLOG=web/run/watchdog.log
URL_FILE=web/run/current_url.txt

update_wan() {
  node -e "require('fs').writeFileSync(process.argv[2]+'/wan.json', JSON.stringify({url:process.argv[1],target:'http://127.0.0.1:$PORT',ts:new Date().toISOString()},null,2))" "$1" "${DECLGEN_DATA_ROOT:-$HOME/.declgen-data}"
  echo "$1" > "$URL_FILE"
  echo "$(date -Is) tunnel url -> $1" >> "$WLOG"
}

server_ok() { curl -s -m 10 -o /dev/null "http://127.0.0.1:$PORT/__health"; }

tunnel_pid() {
  powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { \$_.CommandLine -match 'url http://127.0.0.1:$PORT' }).ProcessId" 2>/dev/null | tr -d '\r' | grep -m1 -E '^[0-9]+$'
}

start_server() {
  # kill whatever stale listener holds the port, then start fresh
  for pid in $(netstat -ano | grep "127.0.0.1:$PORT" | grep LISTENING | awk '{print $NF}' | sort -u); do
    taskkill //PID "$pid" //F >/dev/null 2>&1
  done
  nohup node web/server.mjs >> "$SLOG" 2>&1 &
  echo "$(date -Is) server (re)started" >> "$WLOG"
}

start_tunnel() {
  : > "$TLOG"
  nohup cloudflared tunnel --config web/cloudflared-quick.yml --url "http://127.0.0.1:$PORT" --no-autoupdate >> "$TLOG" 2>&1 &
  for _ in $(seq 1 30); do
    sleep 2
    U=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$TLOG" | tail -1)
    [ -n "$U" ] && { update_wan "$U"; return; }
  done
  echo "$(date -Is) tunnel restart FAILED to yield URL" >> "$WLOG"
}

server_ok || start_server
[ -n "$(tunnel_pid)" ] || { echo "$(date -Is) tunnel missing, starting" >> "$WLOG"; start_tunnel; }

fails=0
while true; do
  sleep 30
  if server_ok; then fails=0; else fails=$((fails+1)); fi
  [ "$fails" -ge 4 ] && { echo "$(date -Is) server unhealthy x$fails -> restart" >> "$WLOG"; start_server; fails=0; }
  [ -n "$(tunnel_pid)" ] || { echo "$(date -Is) tunnel died -> restart" >> "$WLOG"; start_tunnel; }
done
