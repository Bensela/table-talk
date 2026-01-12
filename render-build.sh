#!/usr/bin/env bash
# Exit on error
set -o errexit

npm install --prefix server
npm install --prefix client
npm run build --prefix client

# Run migrations
npm run migrate --prefix server
