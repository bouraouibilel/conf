#!/usr/bin/env bash
set -e

echo "=== Installation du Service Web Admin sur Linux ==="

# Vérification root
if [ "$EUID" -ne 0 ]; then
  echo "Erreur: Ce script doit être exécuté en tant que root (sudo bash install-service.sh)"
  exit 1
fi

INSTALL_DIR="/opt/admin-server"
SERVICE_NAME="admin-server.service"

echo "1. Création du répertoire d'installation dans $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"

echo "2. Copie des fichiers de l'application..."
cp -r ./* "$INSTALL_DIR/"

echo "3. Installation des dépendances npm..."
cd "$INSTALL_DIR"
npm install --production

# Si .env n'existe pas, créer une configuration par défaut
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo "Génération du fichier .env avec un mot de passe sécurisé..."
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  ADMIN_RANDOM_PASS=$(openssl rand -hex 8)
  sed -i "s/adminpassword123/$ADMIN_RANDOM_PASS/g" "$INSTALL_DIR/.env"
  echo "======================================================"
  echo " Identifiant par défaut : admin"
  echo " Mot de passe généré    : $ADMIN_RANDOM_PASS"
  echo "======================================================"
fi

echo "4. Installation du service systemd..."
cp "$INSTALL_DIR/scripts/admin-server.service" "/etc/systemd/system/$SERVICE_NAME"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

echo ""
echo "=== Succès ! ==="
echo "Le service est maintenant actif et démarrera automatiquement au boot."
echo "Statut: systemctl status $SERVICE_NAME"
echo "Logs: journalctl -u $SERVICE_NAME -f"
echo "Accédez à l'interface sur: http://<IP_DE_VOTRE_MACHINE>:4000"
