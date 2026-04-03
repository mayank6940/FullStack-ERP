#!/usr/bin/env bash
set -euo pipefail

# SSL setup script for Ubuntu (without Docker/Nginx assumptions).
# This script obtains certificates and enables auto-renewal.
# You can integrate the generated cert/key files with your chosen reverse proxy.

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <app_domain> <api_domain>"
  echo "Example: $0 app.example.com api.example.com"
  exit 1
fi

APP_DOMAIN="$1"
API_DOMAIN="$2"

sudo apt-get update
sudo apt-get install -y certbot

# Standalone mode requires ports 80/443 to be available during issuance.
sudo certbot certonly --standalone -d "$APP_DOMAIN" -d "$API_DOMAIN" --non-interactive --agree-tos -m admin@"$APP_DOMAIN"

# Auto-renewal via systemd timer is preferred on modern Ubuntu.
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer

echo "Certificates issued successfully."
echo "Certificate path: /etc/letsencrypt/live/$APP_DOMAIN/fullchain.pem"
echo "Private key path: /etc/letsencrypt/live/$APP_DOMAIN/privkey.pem"
echo "Integrate these paths into your reverse proxy/service config."
