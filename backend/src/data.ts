import { z } from "zod";
import { query, transaction } from "./db.js";
import { Decimal } from "decimal.js";
import { decrypt } from "./crypto.js";
import { currentMonth, indicators, tasksFor } from "./rules.js";
export const monthSchema = z
  .string()
  .regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "Competência inválida.");
export const moneySchema = z
  .union([
    z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    z.number().finite().nonnegative().max(999999999999.99),
  ])
  .transform(String);
export const idSchema = z.uuid();
export function selectedMonth(value: unknown) {
  return monthSchema.parse(value || currentMonth());
}
export async function catalogue(month = currentMonth()) {
  const services = await query(
    "SELECT DISTINCT ON(code) * FROM service_versions WHERE effective<=$1 ORDER BY code,effective DESC",
    [month],
  );
  const plans = await query(
    "SELECT DISTINCT ON(code) * FROM plan_versions WHERE effective<=$1 ORDER BY code,effective DESC",
    [month],
  );
  const [contact] = await query(
    "SELECT value FROM settings WHERE key='contact'",
  );
  return { services, plans, contact: contact.value };
}
export async function clientData(month: string, id?: string, portal = false) {
  const rows = await query(
    `SELECT c.*,ct.plan,ct.amount,ct.effective FROM clients c LEFT JOIN LATERAL (SELECT * FROM client_contracts WHERE client_id=c.id AND effective<=$1 ORDER BY effective DESC LIMIT 1) ct ON true ${id ? "WHERE c.id=$2" : ""} ORDER BY c.name`,
    id ? [month, id] : [month],
  );
  const revenues = await query(
    "SELECT * FROM revenues " + (id ? "WHERE client_id=$1" : ""),
    id ? [id] : [],
  );
  const monthly = await query(
    "SELECT * FROM monthly_tasks WHERE month=$1" +
      (id ? " AND client_id=$2" : ""),
    id ? [month, id] : [month],
  );
  const [fiscal] = await query(
    "SELECT config FROM fiscal_configs WHERE year=$1",
    [Number(month.slice(0, 4))],
  );
  const { plans } = await catalogue(month);
  return rows.map((c) => {
    const rev = revenues.filter((r) => r.client_id === c.id),
      m = monthly.find((r) => r.client_id === c.id);
    const plan = plans.find((p) => p.code === c.plan);
    const result: any = {
      id: c.id,
      name: c.name,
      legal_name: c.legal_name,
      cnpj: c.cnpj,
      city: c.city,
      state: c.state,
      type: c.type,
      activity: c.activity,
      plan: c.plan,
      amount: c.amount,
      since_month: c.since_month,
      opening_month: c.opening_month,
      active: c.active,
      month,
      revenues: rev.map(({ month, amount }) => ({ month, amount })),
      tasks: tasksFor(c.type, c.plan || "Avulso", month).map((t) => ({
        ...t,
        done: !!m?.tasks[t.key],
      })),
      notes_count: m?.notes_count || 0,
      notes_meta:
        fiscal && ["MEI Pro", "MEI Growth"].includes(c.plan)
          ? {
              included: fiscal.config.notesIncluded,
              extra: Math.max(
                0,
                (m?.notes_count || 0) - fiscal.config.notesIncluded,
              ),
              reference_total: new Decimal(
                Math.max(
                  0,
                  (m?.notes_count || 0) - fiscal.config.notesIncluded,
                ),
              )
                .mul(fiscal.config.extraNote)
                .toFixed(2),
            }
          : null,
      indicators: indicators(c, month, rev, fiscal?.config, plan),
    };
    if (!portal)
      Object.assign(result, {
        email: c.email,
        municipal_registration: c.municipal_registration,
        phone: c.phone,
        partners: c.partners,
        drive: c.drive,
        notes: decrypt(c.notes),
        onboarding: c.onboarding,
        deletion_pending: c.deletion_pending,
      });
    return result;
  });
}
export async function materializeFees(month: string, id?: string) {
  await transaction(async (db) => {
    await db.query(
      `SELECT id FROM clients WHERE active AND NOT deletion_pending ${id ? "AND id=$1" : ""} ORDER BY id FOR UPDATE`,
      id ? [id] : [],
    );
    await db.query(
      `INSERT INTO fees(client_id,month,plan,amount) SELECT c.id,$1,ct.plan,ct.amount FROM clients c JOIN LATERAL(SELECT plan,amount FROM client_contracts WHERE client_id=c.id AND effective<=$1 ORDER BY effective DESC LIMIT 1) ct ON true WHERE c.active AND NOT c.deletion_pending AND c.since_month<=$1 ${id ? "AND c.id=$2" : ""} ON CONFLICT(client_id,month) DO NOTHING`,
      id ? [month, id] : [month],
    );
  });
}
