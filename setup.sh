#!/bin/bash
set -euo pipefail

echo "=== VPS Setup ==="

# Install Docker if not present
if ! command -v docker &>/dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
fi

# Create swap if not present
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
    echo "Creating 1GB swap..."
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "Done. Now run: make deploy"
