#!/usr/bin/env bash

# Bind address: defaults to localhost (this machine only). Pass 0.0.0.0 to
# accept connections from other devices on the same network, e.g.
#   ./run-servers.sh 0.0.0.0
HOST="${1:-localhost}"

#Web-Server
echo "Starting Web-Server on $HOST:8000..."
python3 https-server.py "$HOST" 8000 &> /dev/null &

#Signaling-Server
echo "Starting Signaling-Server on $HOST:8080..."
nodejs signaling_wss_server.js "$HOST" 8080 &> /dev/null &

if [ "$HOST" = "0.0.0.0" ]; then
    echo
    echo "Other devices on this network can open:"
    for ip in $(hostname -I 2>/dev/null); do
        case "$ip" in *:*) continue ;; esac  # skip IPv6
        echo "  https://$ip:8000/atlas-lobby.html"
    done
    echo "(accept the certificate warning on https://<ip>:8000 and https://<ip>:8080 first)"
fi
