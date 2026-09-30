#!/usr/bin/env bash
set -e

# Ce script configure les permissions sudo pour un utilisateur dédié non-root
TARGET_USER="${1:-webadmin}"

if [ "$EUID" -ne 0 ]; then
  echo "Erreur: Ce script doit être exécuté en tant que root (sudo bash setup-sudoers.sh <username>)"
  exit 1
fi

echo "Configuration des droits sudo sans mot de passe pour l'utilisateur: $TARGET_USER"

SUDOERS_FILE="/etc/sudoers.d/99-web-admin"

cat << EOF > "$SUDOERS_FILE"
# Droits spécifiques pour l'agent d'administration web
$TARGET_USER ALL=(ALL) NOPASSWD: /bin/systemctl reboot, /bin/systemctl poweroff, /sbin/reboot, /sbin/poweroff, /sbin/shutdown, /bin/systemctl restart *, /bin/systemctl start *, /bin/systemctl stop *, /bin/systemctl status *
EOF

chmod 0440 "$SUDOERS_FILE"
echo "Fichier $SUDOERS_FILE créé et validé avec succès."
