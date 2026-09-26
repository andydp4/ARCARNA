#!/usr/bin/env bash
# Builds the money audit dataset: N+1 trading days through the API, ending today.
#
#   bash tests/money/run.sh [last_day_index=15]
#
# Needs a dev server on $PORT started with the Stripe stub and test auth, e.g.
#   STRIPE_SECRET_KEY=sk_test_stub STRIPE_WEBHOOK_SECRET=whsec_stub \
#   NODE_OPTIONS="--import ./tests/money/stripeStub.mjs" PHASE2D_TEST=1 \
#   PHASE2D_TEST_SECRET=journey-suite-local-secret APP_BASE_PATH=/ VITE_BASE_PATH=/ \
#   npm run dev:e2e
# and a FRESH private database (the time travel moves every row).
set -euo pipefail
cd "$(dirname "$0")/../.."
LAST=${1:-15}
export MONEY_STATE=${MONEY_STATE:-/tmp/money-state.json}
npx tsx tests/money/buildDataset.ts setup
for i in $(seq 0 "$LAST"); do
  npx tsx tests/money/buildDataset.ts day "$i" "$LAST"
  if [ "$i" -lt "$LAST" ]; then
    npx tsx tests/money/timeTravel.ts --days 1
    npx tsx tests/money/closeDay.ts
  fi
done
echo "dataset built; state in $MONEY_STATE"
