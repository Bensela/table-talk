#!/usr/bin/env bash
# Exit on error
set -o errexit

npm install --prefix backend
npm install --prefix frontend
npm run build --prefix frontend

# Run migrations
npm run migrate --prefix backend
