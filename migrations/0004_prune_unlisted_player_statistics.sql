-- Keep only statistic keys currently rendered by the NoteSMP website.
DELETE FROM player_statistics
WHERE stat_id NOT LIKE 'minecraft:kill_entity:%'
  AND stat_id NOT IN (
  'mob_kills','player_kills','deaths','time_since_last_death',
  'damage_absorbed','damage_dealt','damage_resisted','damage_taken',
  'jumps','sneak_time','distance_climbed','distance_crouched','distance_fallen',
  'distance_flown','distance_sprinted','distance_swum','distance_walked',
  'distance_walked_under_water','distance_by_boat','distance_by_elytra',
  'distance_by_happy_ghast','distance_by_horse','distance_by_minecart',
  'blocks_placed','blocks_broken','fish_caught','animals_bred','chests_opened',
  'barrels_opened','shulker_boxes_opened','items_dropped','items_enchanted',
  'talked_to_villagers','traded_with_villagers','time_since_last_rest',
  'times_slept_in_a_bed'
);
