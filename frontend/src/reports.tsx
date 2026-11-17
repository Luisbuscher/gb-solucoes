import { useState } from "react";
import { FileText, Download, RefreshCw, CheckCircle2 } from "lucide-react";
import { api, money, date, monthLabel } from "./api";
import {
  useApp,
  useData,
  useSubmit,
  Field,
  Submit,
  Badge,
  State,
  formObject,
  type Row,
} from "./ui";

const parts = [
  ["commerce_with_invoice", "Comércio com nota fiscal"],
  ["commerce_without_invoice", "Comércio sem nota fiscal"],
  ["industry_with_invoice", "Indústria com nota fiscal"],
  ["industry_without_invoice", "Indústria sem nota fiscal"],
  ["services_with_invoice", "Serviços com nota fiscal"],
  ["services_without_invoice", "Serviços sem nota fiscal"],
] as const;
export function ReportsPanel({
  clientId,
  month,
  admin = false,
  onSaved,
}: {
  clientId: string;
  month: string;
  admin?: boolean;
  onSaved?: () => void;
}) {
  const assessment = useData(
      admin ? "/admin/clientes/" + clientId + "/apuracoes/" + month : null,
      null,
    ),
    reports = useData("/relatorios?client_id=" + clientId, []);
  const { run, notify } = useApp();
  const year = month.slice(0, 4);
  const list = reports.data
    .filter((r: Row) => r.period.startsWith(year))
    .sort((a: Row, b: Row) =>
      a.kind === b.kind
        ? b.period.localeCompare(a.period)
        : a.kind === "annual"
          ? -1
          : 1,
    );
  return (
    <>
      {admin && (
        <State loading={assessment.loading} error={assessment.error}>
          {assessment.data && (
            <AssessmentForm
              key={
                clientId +
                month +
                (assessment.data.assessment?.assessed_at || "empty")
              }
              clientId={clientId}
              month={month}
              data={assessment.data}
              onSaved={() => {
                assessment.reload();
                reports.reload();
                onSaved?.();
              }}
            />
          )}
        </State>
      )}
      <div className="card">
        <div className="toolbar">
          <div>
            <h3>
              <FileText size={18} /> Relatórios de {year}
            </h3>
            <p className="hint">
              Gerados automaticamente a partir do faturamento aprovado e da
              apuração.
            </p>
          </div>
          {admin && (
            <button
              className="btn ghost sm"
              onClick={() =>
                void run(async () => {
                  await api("/relatorios/atualizar", "POST", {
                    client_id: clientId,
                    year: Number(year),
                  });
                  reports.reload();
                  notify("Relatórios atualizados com os dados aprovados.");
                })
              }
            >
              <RefreshCw size={14} />
              Atualizar PDFs do ano
            </button>
          )}
        </div>
        <State
          loading={reports.loading && !reports.data.length}
          error={reports.error}
          empty={!list.length}
        >
          <div className="report-list">
            {list.map((r: Row) => (
              <article className="report-item" key={r.id}>
                <div>
                  <p className="eyebrow">
                    {r.kind === "monthly"
                      ? "Declaração mensal de faturamento"
                      : "Consolidado anual de faturamento"}
                  </p>
                  <h3>
                    {r.kind === "monthly" ? monthLabel(r.period) : r.period}
                  </h3>
                  <p className="small">
                    {money(r.total)} · versão {r.revision}
                  </p>
                  <div className="row">
                    <Badge tone={r.complete ? "ok" : "wait"}>
                      {r.complete
                        ? "Apuração completa"
                        : "Prévia com pendências"}
                    </Badge>
                    <span className="hint">
                      Atualizado em {date(r.created_at)}
                    </span>
                  </div>
                  {r.missing.length > 0 && (
                    <p className="hint">
                      Sem valor aprovado:{" "}
                      {r.missing.map((m: string) => m.slice(5)).join(", ")}.
                    </p>
                  )}
                  {r.unclassified.length > 0 && (
                    <p className="hint">
                      Composição de receita pendente:{" "}
                      {r.unclassified.map((m: string) => m.slice(5)).join(", ")}
                      .
                    </p>
                  )}
                  {r.unsupported.length > 0 && (
                    <p className="hint">
                      Documentos não vinculados:{" "}
                      {r.unsupported.map((m: string) => m.slice(5)).join(", ")}.
                    </p>
                  )}
                  {r.year_open && (
                    <p className="hint">
                      Ano em andamento; consolidado parcial.
                    </p>
                  )}
                  {r.employee_missing && (
                    <p className="hint">Confirme se houve empregado no ano.</p>
                  )}
                  {r.identity_missing && (
                    <p className="hint">CNPJ ainda não informado na ficha.</p>
                  )}
                  {admin && r.storage_status !== "Publicado" && (
                    <p className="hint">
                      Cópia em nuvem pendente. O PDF já pode ser baixado.
                      {r.storage_error ? " " + r.storage_error : ""}
                    </p>
                  )}
                </div>
                <a
                  className="btn ghost sm"
                  href={"/api/relatorios/" + r.id + "/download"}
                >
                  <Download size={14} />
                  Baixar PDF
                </a>
              </article>
            ))}
          </div>
        </State>
        <p className="hint">
          Os relatórios são documentos de apoio. A transmissão da DASN-SIMEI e
          da DEFIS e seus recibos continuam nos serviços oficiais. Meses não
          informados não são tratados como faturamento zero.
        </p>
      </div>
    </>
  );
}
function AssessmentForm({
  clientId,
  month,
  data,
  onSaved,
}: {
  clientId: string;
  month: string;
  data: Row;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        parts.map(([key]) => [key, data.assessment?.[key] ?? ""]),
      ),
    ),
    [selected, setSelected] = useState<string[]>(data.document_ids || []);
  const { notify } = useApp();
  const total =
    Object.values(values).reduce(
      (n, v) => n + Math.round(Number(v || 0) * 100),
      0,
    ) / 100;
  const submit = useSubmit(async (form) => {
    const fields = formObject(form);
    await api("/admin/clientes/" + clientId + "/apuracoes/" + month, "PUT", {
      parts: values,
      document_ids: selected,
      notes: fields.notes,
      had_employee:
        fields.had_employee === "" ? null : fields.had_employee === "sim",
    });
    notify(
      "Apuração aprovada. Declaração mensal e consolidado anual atualizados.",
    );
    onSaved();
  });
  return (
    <form className="card" {...submit}>
      <div>
        <p className="eyebrow">Fechamento da competência</p>
        <h3>Apuração de {monthLabel(month)}</h3>
      </div>
      <p className="hint">
        Confira as receitas com os documentos contábeis. Ao concluir, o total
        passa a ser o faturamento aprovado e os PDFs são atualizados
        automaticamente.
      </p>
      {data.approved_amount !== null && (
        <p className="small">
          Faturamento aprovado atual:{" "}
          <strong>{money(data.approved_amount)}</strong>
        </p>
      )}
      <div className="fields">
        {parts.map(([key, label]) => (
          <Field key={key} label={label + " (R$)"}>
            <input
              type="number"
              min="0"
              step=".01"
              required
              value={values[key]}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <div className="toolbar">
        <strong>Total apurado: {money(total)}</strong>
        <button
          className="table-action"
          type="button"
          onClick={() =>
            setValues(
              Object.fromEntries(
                parts.map(([key]) => [key, values[key] || "0.00"]),
              ),
            )
          }
        >
          Preencher campos vazios com zero
        </button>
      </div>
      <section className="evidence-selector">
        <h3>Documentos usados na conferência</h3>
        <p className="hint">
          Vincule notas, extratos e comprovantes. Movimentação bancária, por si
          só, não é considerada receita automaticamente.
        </p>
        {data.documents.length ? (
          <div className="evidence-list">
            {data.documents.map((d: Row) => (
              <label key={d.id} className="evidence-option">
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, d.id]
                        : selected.filter((id) => id !== d.id),
                    )
                  }
                />
                <span>
                  <strong>{d.title}</strong>
                  <small>
                    {d.category} · {monthLabel(d.month)} · {d.filename}
                  </small>
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="hint">
            Nenhum documento enviado para este cliente. Publique ou receba os
            documentos para vinculá-los à apuração.
          </p>
        )}
      </section>
      <Field label="Houve empregado no ano-calendário? (informação para DASN-SIMEI)">
        <select
          name="had_employee"
          defaultValue={
            data.had_employee === null ? "" : data.had_employee ? "sim" : "nao"
          }
        >
          <option value="">Ainda não confirmado</option>
          <option value="sim">Sim</option>
          <option value="nao">Não</option>
        </select>
      </Field>
      <Field label="Observações internas da apuração">
        <textarea
          name="notes"
          maxLength={1000}
          defaultValue={data.assessment?.notes || ""}
        />
      </Field>
      <div>
        <Submit busy={submit.busy}>
          <CheckCircle2 size={14} />
          Concluir apuração e atualizar relatórios
        </Submit>
      </div>
    </form>
  );
}
export function PortalReports({ month }: { month: string }) {
  const client = useData("/me?month=" + month, null);
  return (
    <State loading={client.loading} error={client.error}>
      {client.data && <ReportsPanel clientId={client.data.id} month={month} />}
    </State>
  );
}
