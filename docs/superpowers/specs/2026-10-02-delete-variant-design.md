# Deleting a single mock exam from the teacher panel

Date: 2026-10-02. Approved by the owner in chat.

## Problem

Mock-exam history syncs add-only: a device pulls new `variants` rows and unions
them with its local list. A row removed on the server therefore stays on every
device of the student. The only way to drop a stray result (an exam finished by
accident with 0 points) was SQL on the production server, and even that did not
reach the student's screen.

## Decision

Only the teacher deletes, from the student card in `teacher.html`. Students get
no per-record delete, so they cannot hide a bad result.

## Design

**Server** — migration `1790800005_variant_deletes.js`:

- new collection `variant_deletes` (`user`, `uid`, `created`): a tombstone
  saying "the mock exam with this uid is gone". Readable by its owner and the
  teacher, created by the teacher only, never updated or deleted.
- `variants.deleteRule` becomes teacher-only (was superuser-only).
- `users` is not touched, so no sessions are invalidated.

**Panel** — each row in "Пробники" gets a "Удалить" button. After a
confirmation sheet the panel sends one `/api/batch` request: create the
tombstone and delete the `variants` row. The batch is transactional, so a row
never survives its own tombstone and a tombstone is never lost.

**Trainer** — `Sync.pull` also fetches new `variant_deletes` rows (same cursor
mechanism as the other collections) and passes their uids to
`SyncCore.mergeVariants(local, incoming, clears, deleted)`, which drops the
matching records. A failed fetch of this one collection is treated as "nothing
new" so that a trainer released before the server migration keeps syncing.

## Not doing

- Undo. A mistaken delete is restored from the nightly backup only.
- Guarding against a device re-uploading a deleted record. It would need a lost
  server response followed by a teacher delete before the retry a few seconds
  later.

## Testing

- `tests/sync-core.test.mjs`: `mergeVariants` drops deleted uids.
- `backend/tests/rules.test.mjs`: a student can neither create a tombstone nor
  delete a variant; the teacher's batch removes the row and leaves a tombstone
  the owner can read and another student cannot.
- Manual run against a local PocketBase: finish a mock exam, delete it in the
  panel, watch it leave the trainer's history.

## Rollout

1. Server first: copy the migration, `systemctl restart ege-api`.
2. Merge the PR (bumps `VERSION` in `sw.js`).
3. One-off: create a tombstone for the record removed by hand on 2026-10-02
   (its uid is in `/root/ege-data-before-delete-20261002.db`).
