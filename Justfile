lint:
    node scripts/check.mjs

test:
    node --test --test-concurrency=2 tests/*.test.mjs
