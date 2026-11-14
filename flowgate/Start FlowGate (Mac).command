#!/bin/bash
# Double-click this file to start FlowGate on a Mac.
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ==============================="
echo "    Starting FlowGate..."
echo "  ==============================="
echo ""

if ! command -v node > /dev/null 2>&1; then
  echo "  PROBLEM: Node is not installed on this Mac."
  echo ""
  echo "  How to fix it:"
  echo "    1. Go to  https://nodejs.org"
  echo "    2. Click the big green button on the left (it says LTS)."
  echo "    3. Open the file that downloads and click Continue until it finishes."
  echo "    4. Close this window and double-click this file again."
  echo ""
  echo "  Press Enter to close."
  read -r _
  exit 1
fi

# Open the web page a moment after the server starts.
( sleep 3; open "http://localhost:4000" >/dev/null 2>&1 ) &

echo "  Your browser will open in a few seconds."
echo "  If it does not, type this into your browser:  http://localhost:4000"
echo ""
echo "  KEEP THIS WINDOW OPEN while you use FlowGate."
echo "  To stop: click this window and press Control and C."
echo ""

node server.js --reset

echo ""
echo "  FlowGate has stopped. Press Enter to close this window."
read -r _
