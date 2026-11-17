exports.up = (pgm) =>
  pgm.sql(`
ALTER TABLE sessions ADD COLUMN auth_fingerprint text;
DELETE FROM sessions WHERE user_id IS NOT NULL;
`);
exports.down = false;
