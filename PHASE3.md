# Wany — Phase 3 Personal Lists

Phase 3 adds personal lists on top of the existing Phase 2 user library. It deliberately does not implement modular profiles, public/private profile visibility, avatars, owner overrides, or other later phases.

## Existing system reused

- Authentication and sessions remain unchanged.
- Phase 2 `user_library`, `reading_progress`, and `reading_history` remain authoritative for reading state.
- The existing `favorites` table remains authoritative for Favorites. The list manager presents Favorites as a special option but does not duplicate it into `user_lists`.
- Existing source covers and `SourceCoverImage` are reused at original source quality.

## Database

Schema version: 4.

New tables:

- `user_lists`: owner, user-defined name/description, list position, creation/update timestamps.
- `user_list_items`: many-to-many join between a list and a work, with persistent item position and added timestamp.

The composite primary key `(list_id, manga_id)` prevents duplicate work rows inside one list while allowing the same work in many lists.

Ordering uses sparse REAL positions with 1024-point gaps. A move normally updates one item. If neighboring positions become too close, the list is rebalanced in one batch.

Migration: `migrations/0003_user_lists.sql`.

## API

Authenticated Phase 3 routes:

- `GET /api/lists`
- `POST /api/lists`
- `GET /api/lists/:id`
- `PUT /api/lists/:id`
- `DELETE /api/lists/:id`
- `GET /api/lists/membership/:mangaId`
- `POST /api/lists/:id/items`
- `DELETE /api/lists/:id/items/:mangaId`
- `PUT /api/lists/:id/reorder`

Every list mutation scopes ownership to the authenticated user in D1. Item mutations first verify the list belongs to that user.

Deleting a list only deletes that list (and its join rows through the list foreign key). It never deletes `user_library`, `reading_progress`, or `reading_history`.

## Frontend

- `/lists`: Favorites special card, personal lists, create flow, loading/error/empty states.
- `/lists/:id`: list details, edit/delete, remove work, persisted manual ordering.
- Work page: list membership sheet with checkboxes and inline list creation.

Drag and drop uses Pointer Events with an explicit handle rather than making the whole card draggable. The handle has `touch-action: none`; the card/link itself keeps normal page scrolling and navigation behavior. Keyboard users can move the focused handle with Arrow Up/Down.

No DnD dependency was added.

## Validation

The repository validation workflow remains the source of truth:

- `pnpm test`
- `pnpm build` (includes TypeScript)
- `node --check` for Pages Functions

There is no separate lint script in `package.json`.
