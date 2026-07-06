# Profiles

This repository is trimmed for the Oracle PL/SQL stored procedure to FSD flow.

Only `oracle-sp.json` is active. `list-services.cjs --profile auto` is intentionally limited to `oracle-sp` so this package cannot accidentally route a Java/Dubbo/HTTP repository through the SQL/FSD pipeline.
