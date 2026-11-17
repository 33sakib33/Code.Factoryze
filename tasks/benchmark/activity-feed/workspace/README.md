# Northstar activity feed

A small project-management service. The feed shows the latest activity in one
workspace, with each contributor's current display name. Entries from former
members stay visible as `Former member`. Activity is ordered by descending
sequence number; the requested limit applies before rendering.

- `feed/feed.py`: feed service
- `feed/repository.py`: workspace-scoped SQLite access
- `feed/models.py`: stored records
- `feed/render.py`: response formatting
- `feed/sample.py`: in-memory example

The service receives a SQLite connection from its caller. It must not close that
connection or modify stored data while building a feed. No packages, external
services or database installation are required.

Run the example with `python -m feed.sample` and public checks with
`python -m unittest`. On Windows, run each command separately; the agent uses
Windows PowerShell 5.1.
