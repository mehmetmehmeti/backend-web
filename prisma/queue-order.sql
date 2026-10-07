BEGIN;
ALTER TABLE commands ADD COLUMN IF NOT EXISTS queue_position BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commands_queue_position_key ON commands(queue_position);
ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS sequence BIGSERIAL NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sync_outbox_sequence_key ON sync_outbox(sequence);
COMMIT;
