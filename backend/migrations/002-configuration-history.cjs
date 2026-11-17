exports.up = (pgm) =>
  pgm.sql(`
CREATE TABLE configuration_history (
 id bigserial PRIMARY KEY, kind text NOT NULL, entity text NOT NULL, effective text,
 data jsonb NOT NULL, actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION record_configuration_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO configuration_history(kind,entity,effective,data)
 VALUES(TG_TABLE_NAME,COALESCE(to_jsonb(NEW)->>'code',to_jsonb(NEW)->>'year',to_jsonb(NEW)->>'key'),COALESCE(to_jsonb(NEW)->>'effective',to_jsonb(NEW)->>'year'),jsonb_build_object('before',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,'after',to_jsonb(NEW)));
 RETURN NEW;
END;
$$;
CREATE TRIGGER plans_history AFTER INSERT OR UPDATE ON plan_versions FOR EACH ROW EXECUTE FUNCTION record_configuration_change();
CREATE TRIGGER services_history AFTER INSERT OR UPDATE ON service_versions FOR EACH ROW EXECUTE FUNCTION record_configuration_change();
CREATE TRIGGER fiscal_history AFTER INSERT OR UPDATE ON fiscal_configs FOR EACH ROW EXECUTE FUNCTION record_configuration_change();
CREATE TRIGGER settings_history AFTER INSERT OR UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION record_configuration_change();
`);
exports.down = false;
