# Use SQLite for local Session state

Vidscribe v1 stores Session status, intake metadata, progress, and recovery references in SQLite while keeping media and generated artifacts on disk. SQLite matches the single-user local application and avoids operating a database server; the persistence layer should use portable relational patterns so PostgreSQL remains a viable future migration if remote or multi-user access is introduced.
