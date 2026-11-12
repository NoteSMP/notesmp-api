-- Recipe advancements are not NoteSMP achievements and must never be retained.
DELETE FROM player_advancements
WHERE advancement_id GLOB '*:recipes/*';
