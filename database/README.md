# e-Sajda server-side cache database

This folder stores server-side cache created by `api.php` and `weather.php`.

## Purpose

- Save prayer API responses after first city/location search.
- Reuse cached responses on repeated requests to reduce upstream API calls and speed up responses.

## Structure

- `cache.db` is created automatically at runtime (SQLite).
- Table `cities` stores normalized city/location identity.
- Table `city_cache` stores cached payloads linked to `cities.id`.
  - `data_type = prayer` with variant keys (today/month + method + date + timezone)
  - `data_type = weather` with variant key `current`
- `prayer-cache/*.json` may exist from the old cache system and can be deleted safely.

## Notes

- Cache TTL is controlled in `api.php`.
- Weather cache TTL is controlled in `weather.php`.
- SQLite requires PHP PDO SQLite driver enabled.
