#!/usr/bin/env bash
# Day 28 Part 4: official project checks ek predictable order me, pehli failure par ruk jaata hai.
#   npm ci -> npm run lint -> npm test -> npm run lint:eslint -> npm run build
# Yeh script sirf command ke naam aur exit status print karta hai. Koi environment value, secret ya database URL kabhi print nahi hota.
# Network chahiye (npm ci). Node major version .nvmrc se match honi chahiye. Production, database, SQL, deploy: kuch nahi.
# Usage: bash scripts/day28-verify.sh   (kisi bhi folder se chalega; project root khud dhoondhta hai)
#
# Exit codes: 0 = sab pass | 64 = setup problem (node/npm/.nvmrc nahi mila) | 65 = Node major .nvmrc se alag
#             warna = fail hui command ka apna exit status.

set -u
set -o pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || { echo "day28-verify: cannot enter the project root"; exit 64; }

# CI jaisa saaf maahol: asli database / secret / Revive / tracking values in commands tak pahunchne hi nahi dete.
# (unset sirf is script ke process me hota hai; aapke shell ko kuch nahi hota. Koi value print nahi hoti.)
unset TEST_DATABASE_URL TEST_DB_CONFIRM TEST_SUPABASE_PROJECT_REF DATABASE_URL POSTGRES_URL SUPABASE_DB_URL
unset SUPABASE_SECRET_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_SUPABASE_ANON_KEY
unset BLISSCCO_PUBLISHER_API_KEY BLISSCCO_API_BASE_URL AD_TRACKING_SECRET AD_TRACKING_SECRET_PREVIOUS AD_TRACKING_TTL_SECONDS
unset REVIVE_FALLBACK_ENABLED REVIVE_DELIVERY_URL REVIVE_TIMEOUT_MS REVIVE_RESPONSE_FORMAT REVIVE_JSON_PREVIEW_ENABLED
unset NODE_ENV NPM_CONFIG_PRODUCTION NPM_CONFIG_OMIT

command -v node >/dev/null 2>&1 || { echo "day28-verify: node not found"; exit 64; }
command -v npm >/dev/null 2>&1 || { echo "day28-verify: npm not found"; exit 64; }
[ -f .nvmrc ] || { echo "day28-verify: .nvmrc not found"; exit 64; }

expected_major="$(tr -d '[:space:]' < .nvmrc)"
expected_major="${expected_major#v}"
expected_major="${expected_major%%.*}"
actual_major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$actual_major" != "$expected_major" ]; then
  echo "day28-verify: Node major version does not match .nvmrc (expected $expected_major, found $actual_major)"
  exit 65
fi

total=5
run_step() {
  label="$1"
  shift
  echo "==> RUN  $label"
  "$@"
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "<== FAIL $label (exit $status)"
    echo "day28-verify: stopped at the first failure; later commands were not run"
    exit "$status"
  fi
  echo "<== PASS $label (exit 0)"
}

run_step "npm ci" npm ci
run_step "npm run lint" npm run lint
run_step "npm test" npm test
run_step "npm run lint:eslint" npm run lint:eslint
# Build ko CI jaise sirf nakli (dummy) public-shaped values milti hain, taaki koi asli Supabase config build me na jaaye.
run_step "npm run build" env NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_dummy SUPABASE_SECRET_KEY=sb_secret_dummy npm run build

echo "day28-verify: all $total commands passed"
exit 0
