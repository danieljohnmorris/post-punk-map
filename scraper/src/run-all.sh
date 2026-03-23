#!/bin/bash
set -e
echo "=== Waiting for tag discovery to finish ==="
# Tag discovery is already running, this script runs enrichment after
echo "=== Starting image/bio enrichment ==="
npx tsx src/enrich-images.ts
echo "=== All done ==="
