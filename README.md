# ⚡ RemoteAdmin - Multi-Machines Réseau, Tunnels & Contrôle Sécurisé

Application d'administration web centralisée permettant de gérer **la machine locale** ainsi que **toutes les machines Linux/Windows de votre réseau local (LAN)**, avec automatisation complète des **tunnels d'exposition web (Cloudflare & AutoSSH)** et contrôle strict par mot de passe pour chaque action sensible.

---

## 🌟 Fonctionnalités Complètes

### 1. 🌐 Automatisation des Tunnels & Exposition Web (Cloudflare & AutoSSH)
Un onglet dédié **🌐 Tunnels Web** permet d'exposer n'importe quel service local (web, API, SSH, etc.) sur Internet sans ouvrir de ports sur votre box / pare-feu :

- ☁️ **Tunnels Cloudflare (`cloudflared`)** :
  - **Quick Tunnel (Gratuit & Instantané)** : Génère automatiquement une URL publique sécurisée `https://xxxx.trycloudflare.com` en quelques secondes.
  - **Named Tunnel (Zero Trust)** : Prise en charge des jetons de tunnel Cloudflare pour associer un nom de domaine personnalisé fixe.
  - Récupération et affichage en temps réel de l'URL publique avec bouton de copie rapide.
- 🔀 **Tunnels Inverses AutoSSH (`autossh`)** :
  - Redirection automatique d'un port local vers un port public sur votre VPS distant (`-R remote_port:127.0.0.1:local_port`).
  - Maintien en vie et reconnexion automatique en cas de coupure réseau.
  - Prise en charge de `GatewayPorts` (`0.0.0.0`) pour rendre le port accessible mondialement sur le VPS.
- 🚀 **Générateur & Installateur Systemd Automatique (1-Clic)** :
  - Génère automatiquement le fichier d'unité `/etc/systemd/system/tunnel-*.service` prêt pour Linux.
  - Bouton pour **installer et activer le service au boot en 1 clic** directement sur la machine cible sans taper une seule commande !

---

### 2. 🖥️ Gestion de Parc Multi-Machines (Réseau Local)
- **Inventaire Réseau** : Enregistrez vos serveurs, postes de travail, NAS et conteneurs distants (Nom, IP, Port SSH, Utilisateur, Mot de passe ou Clé privée SSH).
- **Sélecteur de Cible Global** : Un menu déroulant dans la barre supérieure permet de basculer instantanément de machine :
  - Le **Terminal Web** ouvre directement une session SSH interactive sur la machine choisie.
  - Les **Commandes Shell** s'exécutent sur la machine sélectionnée.
  - Les **Actions d'alimentation (Reboot / Shutdown)** ciblent la machine active.
  - Les **Services systemd** affichent et contrôlent les services distants.
  - Le **Monitoring** récupère les métriques de la machine cible.
- **Wake-on-LAN (WOL)** : Réveillez une machine éteinte à distance via un paquet magique UDP.

---

### 3. 🔒 Protection par Mot de Passe pour les Actions Sensibles
Toutes les actions critiques nécessitent la saisie obligatoire du mot de passe administrateur :
- Redémarrage (Reboot) et Arrêt complet (Shutdown)
- Forcer l'arrêt d'un processus (`kill`)
- Arrêter ou redémarrer un service système (`systemctl stop/restart`)
- Supprimer un fichier, une machine ou un tunnel

---

## 🚀 Démarrage Rapide

### 1. Démarrer le serveur
```bash
npm start
```
Accès navigateur : **`http://localhost:4000`**
- **Utilisateur par défaut** : `admin`
- **Mot de passe par défaut** : `admin123` (modifiable dans [.env](file:///d:/work/sample/admin-server/.env))

### 2. Exposer un service sur le Web
1. Allez dans l'onglet **🌐 Tunnels Web**.
2. Cliquez sur **☁️ Nouveau Tunnel Cloudflare** (ou **🔀 AutoSSH**).
3. Choisissez la machine hébergeant le service et le port local (ex: `3000`, `8080`).
4. Cliquez sur **Démarrer** :
   - Pour Cloudflare : l'URL `https://xxxx.trycloudflare.com` s'affiche immédiatement.
   - Vous pouvez également cliquer sur **⚙️ Service Systemd** pour que le tunnel démarre automatiquement au boot de la machine Linux !
