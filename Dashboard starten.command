#!/bin/bash
# Doppelklick-Starter fuer macOS (im Finder oeffnen).
#
# Aendert nichts am System: kein LaunchAgent, kein Autostart, keine
# Registrierung. Startet den Server im Vordergrund und oeffnet den Browser;
# Fenster schliessen bzw. Strg+C beendet ihn wieder.
#
# Einmalig ausfuehrbar machen, falls noetig:
#   chmod +x "Dashboard starten.command"

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden. Bitte Node >= 20 installieren:"
  echo "  https://nodejs.org  oder  brew install node"
  echo ""
  read -r -p "Mit Enter schliessen."
  exit 1
fi

exec node src/server.js --open
