Player accounts, characters and the shared world state are written into this
folder at runtime.

If PDO SQLite is available you will see realmforge.sqlite here; otherwise the
game falls back to realmforge.json. Either way, backing up this folder backs up
every account. Deleting it resets the world and wipes all characters.

This folder must be writable by the web server (755 is usually enough, 777 on
stricter hosts).
