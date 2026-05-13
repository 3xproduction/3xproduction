# Codex checkpoint

Updated: 2026-05-12

Current task:
- Continue previous work on the "Админка" section in the Catalog.
- Warehouse roles can also replenish stock.
- Site director can also replenish stock.
- Receipt attachment is allowed but not required for now.
- Result must be deployed to staging/test.

Working notes:
- Project root: `C:\Users\Editor08\Desktop\3xproduction`.
- Worktree is already heavily dirty and `master` is ahead of `origin/master` by 2 commits.
- Do not revert existing user/WIP changes.
- Before staging deploy, run local checks and the Claude/Codex review gate required by `CODEX.md`.
- Prod deploy is out of scope unless the user explicitly approves it.

Changes in this continuation:
- Fixed `frontend/src/components/shared/AddUnitModal.jsx` so warehouse directors/deputies are not blocked by the regular warehouse valuation requirement when adding units in `mode="admin"`.
- Fixed `backend/src/routes/adminUnits.js` review notes: `purchased=true` now requires a valid positive price server-side, and the admin-stock list only returns `status='on_stock'`.
- Hardened `/admin-units`: validated category, limited receipt uploads to JPEG/PNG/WebP/PDF, forced integer `qty`, and made legacy `/units` reject accidental `is_admin_stock` payloads.
- Hardened purchase metadata: admin-stock purchase data is kept whenever price/vendor/receipt imply a purchase, receipt URLs must point to our `receipts/` S3 prefix, and admin-stock roles can delete only admin-stock rows through the existing single-unit delete endpoint.

Verification/deploy:
- Focus checks passed: `node --check backend/src/routes/adminUnits.js`, `node --check backend/src/routes/units.js`, `npx.cmd eslint src\components\shared\AddUnitModal.jsx`, `npm.cmd run build`.
- Full frontend lint remains red from pre-existing repo-wide issues; not fixed in this task.
- Claude fast review: PASS. Gate: PASS with `-SkipFrontend`.
- Deployed to staging `test-v2.84`, revision `bbabduekqc20ofjaol02`, digest `sha256:3c8e9c16be17f91a959d63d49be8d0c5c3c1dc31e9b295cf83bab617f6e5db85`.
- Staging smoke: `/health=200`, `/manifest.webmanifest=200`; API smoke with `X-Auth-Token`: `warehouse_staff` create/list/delete admin-stock OK, `project_director` create/list/delete admin-stock OK, `producer` `/admin-units` returns 403.
