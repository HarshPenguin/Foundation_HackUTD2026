# MediClaim (deliberately legacy demo app)

A fake Medicare-style claims-intake app written the way many 2012-era PHP apps were.
**It is intentionally broken.** Foundation's crew audits and repairs it during the demo.
Do not fix these by hand; the agent runs do.

Planted problems:
1. SQL injection in claim search (`public/search.php`)
2. Float rounding bug in claim totals (`lib/totals.php`)
3. Outdated jQuery 1.4.2 (`public/index.php`)
4. Hardcoded database password (`config.php`)
5. No tests
6. Dead code (`public/old_export.php`)
