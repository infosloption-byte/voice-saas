#!/usr/bin/env bash
# ── GCP VM setup script ───────────────────────────────────────────────
# Run this ONCE on a fresh GCP Compute Engine VM (Ubuntu 22.04 + GPU).
# It installs: Docker, Docker Compose v2, NVIDIA driver, nvidia-container-toolkit.
#
# Usage:
#   chmod +x setup_gcp_vm.sh
#   sudo bash setup_gcp_vm.sh
#
# After this script completes, log out and back in, then deploy with:
#   docker compose -f docker-compose.gcp.yml up -d --build

set -euo pipefail

echo "=== [1/5] System update ==="
apt-get update -y && apt-get upgrade -y

echo "=== [2/5] Install Docker ==="
apt-get install -y ca-certificates curl gnupg lsb-release
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable docker
systemctl start docker
usermod -aG docker "$SUDO_USER"

echo "=== [3/5] Install NVIDIA driver ==="
apt-get install -y ubuntu-drivers-common
ubuntu-drivers autoinstall   # installs the recommended driver for your GPU

echo "=== [4/5] Install nvidia-container-toolkit ==="
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
    gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt-get update -y
apt-get install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

echo "=== [5/5] Install git ==="
apt-get install -y git

echo ""
echo "================================================================"
echo " Setup complete. IMPORTANT: log out and back in so Docker group"
echo " membership takes effect, then verify with:"
echo "   docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi"
echo "================================================================"
