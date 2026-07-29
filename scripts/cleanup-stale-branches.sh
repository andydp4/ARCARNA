#!/usr/bin/env bash
# Stale-branch cleanup (Batch 6 of the Experience Audit remediation).
#
# Deletes the dead cursor/* investigation branches. Every PR raised from
# these is closed or merged — #50/#52/#53 were the last three open drafts,
# closed as superseded by #77 (order-delete fix) and #86 (settlement).
#
# Run from a machine with push rights (branch deletion does not work through
# the agent git proxy). Re-runnable: already-deleted refs just warn.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "Deleting dead cursor/* investigation branches…"
for b in \
  cursor/critical-bug-inspection-4dea \
  cursor/critical-bug-investigation-043e \
  cursor/critical-bug-investigation-0a18 \
  cursor/critical-bug-investigation-259c \
  cursor/critical-bug-investigation-2e5a \
  cursor/critical-bug-investigation-40c6 \
  cursor/critical-bug-investigation-61cd \
  cursor/critical-bug-investigation-6491 \
  cursor/critical-bug-investigation-7425 \
  cursor/critical-bug-investigation-764a \
  cursor/critical-bug-investigation-9b7e \
  cursor/critical-bug-investigation-9e9b \
  cursor/critical-bug-investigation-a4b7 \
  cursor/critical-bug-investigation-acc4 \
  cursor/critical-bug-investigation-be70 \
  cursor/critical-bug-investigation-c82b \
  cursor/critical-bug-investigation-d2f4 \
  cursor/critical-bug-investigation-d3d2 \
  cursor/critical-bug-investigation-d3ea \
  cursor/critical-bug-investigation-ee0f \
  ; do
  git push origin --delete "$b" || echo "  (skip: $b)"
done

echo "Done. Remaining branches:"
git ls-remote --heads origin | sed "s#.*refs/heads/##" | sort
