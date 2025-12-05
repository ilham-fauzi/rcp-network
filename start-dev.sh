#!/bin/bash

# Start VPN Client in development mode
# This script ensures React server is ready before starting Electron

cd "$(dirname "$0")"

echo "Starting React development server..."
npm start &
REACT_PID=$!

echo "Waiting for React server to be ready..."
# Wait for server to be ready (max 60 seconds)
for i in {1..60}; do
  if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo "React server is ready!"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "Error: React server did not start in time"
    kill $REACT_PID 2>/dev/null
    exit 1
  fi
  sleep 1
done

echo "Starting Electron..."
ELECTRON_IS_DEV=1 electron .

# Cleanup on exit
trap "kill $REACT_PID 2>/dev/null" EXIT


