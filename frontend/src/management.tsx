import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Check,
  ArrowUpRight,
  FolderOpen,
  CheckCircle2,
  Clock3,
} from "lucide-react";
import { api, money, monthLabel } from "./api";
import { VaultPanel } from "./vault";
import { ReportsPanel } from "./reports";
import { Documents } from "./workflows";
import {
  useData,
  useApp,
  State,
  Stat,
  Field,
  Submit,
  Badge,
  Modal,
  useSubmit,
  formObject,
  type Row,
} from "./ui";
const sum = (rows: Row[], key: string) =>
  rows.reduce((n, r) => n + Math.round(Number(r[key] || 0) * 100), 0) / 100;
export function Dashboard({ month, client }: { month: string; client?: Row }) {
  const list = useData(client ? null : "/admin/clientes?month=" + month, []);
  const fees = useData(
    client ? "/me/honorarios" : "/admin/honorarios?month=" + month,
    [],
  );
  const docs = useData(client ? "/documentos" : null, []);
  const [open, setOpen] = useState("");
  const rows = client
      ? [client]
      : list.data.filter((c: Row) => c.active && !c.deletion_pending),
    alerts = rows.filter((c: Row) => c.indicators.alert);
  const pending = rows.reduce(
    (n: number, c: Row) => n + c.tasks.filter((t: Row) => !t.done).length,
    0,
  );
  const total = sum(
      fees.data.filter((f: Row) => f.month === month),
      "amount",
    ),
    paid = sum(
      fees.data.filter((f: Row) => f.month === month && f.paid),
      "amount",
    );
  const currentGuide = docs.data.find(
    (d: Row) => d.category === "Guias" && d.month === month,
  );
  const report = docs.data.find((d: Row) => d.category === "Relatórios");
  return (
    <>
      <State loading={!client && list.loading} error={list.error}>
        {client ? (
          <>
            <div className="row between">
              <div>
                <p className="eyebrow">Seu negócio</p>
                <h3>{client.name}</h3>
              </div>
              <Badge tone="ok">{client.plan || "Plano a definir"}</Badge>
            </div>
            <div className="grid">
              <Stat
                label="Guia DAS da competência"
                value={
                  client.indicators.das === null
                    ? "A definir"
                    : money(client.indicators.das)
                }
                detail={
                  currentGuide ? (
                    <a
                      href={"/api/documentos/" + currentGuide.id + "/download"}
                    >
                      Baixar guia publicada <ArrowUpRight size={12} />
                    </a>
                  ) : (
                    "A guia aparecerá quando for publicada pela GB."
                  )
                }
              />
              <Stat
                label="Faturamento aprovado no ano"
                value={money(client.indicators.annual)}
                detail={
                  client.indicators.limit === null
                    ? "Parâmetro anual a definir"
                    : `${Math.round((client.indicators.use || 0) * 100)}% do limite de ${money(client.indicators.limit)}`
                }
                alert={client.indicators.alert}
              />
              <Stat
                label="Honorário da competência"
                value={money(total)}
                detail={
                  total
                    ? paid === total
                      ? "Recebimento confirmado"
                      : "Aguardando confirmação de recebimento"
                    : "Nenhuma cobrança registrada."
                }
              />
            </div>
            <RevenueChart c={client} month={month} />
            <div className="card">
              <h3>Como está seu mês</h3>
              <div className="list">
                {client.tasks.map((t: Row) => (
                  <div key={t.key}>
                    <span>{t.name}</span>
                    <Badge tone={t.done ? "ok" : "wait"}>
                      {t.done ? "Concluído" : "Em andamento"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
            {report && (
              <div className="card notification">
                <div>
                  <h3>Seu relatório está disponível</h3>
                  <p className="muted small">{report.title}</p>
                </div>
                <Link to="/portal/documentos" className="btn ghost">
                  Ver meus documentos <ArrowUpRight size={14} />
                </Link>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid">
              <Stat
                label="Honorários do mês"
                value={money(total)}
                detail={`${rows.length} clientes ativos · ${money(paid)} recebidos`}
              />
              <Stat
                label="Tarefas pendentes"
                value={pending}
                detail={
                  pending
                    ? "Etapas da rotina que precisam de atenção."
                    : "Rotina da competência em dia."
                }
              />
              <Stat
                label="Alertas de faturamento"
                value={`${alerts.length} clientes`}
                alert={alerts.length > 0}
                detail="Limites e faixas da carteira"
              />
            </div>
            {alerts.length > 0 && (
              <div className="card">
                <h3>Um olhar mais atento</h3>
                <div className="list">
                  {alerts.map((c: Row) => (
                    <div key={c.id}>
                      <span>
                        <strong>{c.name}</strong>
                        <br />
                        <span className="small muted">
                          {c.type === "MEI"
                            ? `${Math.round((c.indicators.use || 0) * 100)}% do limite · projeção ${money(c.indicators.projection)}`
                            : c.indicators.band}
                        </span>
                      </span>
                      <button
                        className="table-action"
                        onClick={() => setOpen(c.id)}
                      >
                        Abrir ficha
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="card">
              <div className="toolbar">
                <h3>Situação dos clientes</h3>
                <Link to="/admin/clientes" className="btn ghost sm">
                  <Plus size={14} />
                  Gerenciar clientes
                </Link>
              </div>
              {rows.length ? (
                <ClientTable rows={rows} onOpen={setOpen} />
              ) : (
                <div className="empty">
                  <h3>Seu primeiro próximo passo</h3>
                  <p className="muted">
                    Cadastre um cliente para acompanhar a rotina, os documentos
                    e os honorários.
                  </p>
                  <Link to="/admin/clientes" className="btn">
                    Cadastrar cliente
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </State>
      {open && (
        <ClientDrawer
          id={open}
          month={month}
          onClose={() => setOpen("")}
          onSaved={() => {
            list.reload();
            fees.reload();
          }}
        />
      )}
    </>
  );
}
function RevenueChart({ c, month }: { c: Row; month: string }) {
  const values = Array.from({ length: 12 }, (_, i) => ({
    month: month.slice(0, 4) + "-" + String(i + 1).padStart(2, "0"),
    value: 0,
  })).map((r) => ({
    ...r,
    value: Number(
      c.revenues.find((v: Row) => v.month === r.month)?.amount || 0,
    ),
  }));
  const max = Math.max(...values.map((v) => v.value), 1);
  return (
    <div className="card">
      <div className="toolbar">
        <h3>Faturamento mês a mês</h3>
        <span className="small muted">
          {month.slice(0, 4)} · valores aprovados
        </span>
      </div>
      <div className="chart">
        {values.map((v) => (
          <div key={v.month} className={v.month === month ? "last" : ""}>
            <span className="num">
              {v.value
                ? (v.value / 1000).toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })
                : ""}
            </span>
            <i
              title={money(v.value)}
              style={{ height: v.value ? (v.value / max) * 100 + "%" : "0" }}
            />
          </div>
        ))}
      </div>
      <div className="months">
        {[
          "jan",
          "fev",
          "mar",
          "abr",
          "mai",
          "jun",
          "jul",
          "ago",
          "set",
          "out",
          "nov",
          "dez",
        ].map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <p className="hint">Valores do gráfico em milhares de reais.</p>
    </div>
  );
}
function ClientTable({
  rows,
  onOpen,
}: {
  rows: Row[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Cliente / plano</th>
            <th>Guia DAS</th>
            <th>Dados do mês</th>
            <th>Faturamento</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
                <p className="muted">
                  {c.plan || "Sem contrato nesta competência"}
                </p>
              </td>
              {["das", "dados"].map((key) => (
                <td key={key}>
                  {c.tasks.some((t: Row) => t.key === key) ? (
                    <Badge
                      tone={
                        c.tasks.find((t: Row) => t.key === key).done
                          ? "ok"
                          : "wait"
                      }
                    >
                      {c.tasks.find((t: Row) => t.key === key).done
                        ? "Concluído"
                        : "Pendente"}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
              <td>
                {c.type === "MEI" ? (
                  c.indicators.limit === null ? (
                    <Badge tone="na">A definir</Badge>
                  ) : (
                    <Badge tone={c.indicators.alert ? "alert" : "ok"}>
                      {Math.round((c.indicators.use || 0) * 100)}% do limite
                    </Badge>
                  )
                ) : (
                  <Badge tone={c.indicators.alert ? "alert" : "na"}>
                    {c.indicators.band || "Sem lançamentos"}
                  </Badge>
                )}
              </td>
              <td className="r">
                <button className="table-action" onClick={() => onOpen(c.id)}>
                  Abrir ficha
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Clients({ month }: { month: string }) {
  const list = useData("/admin/clientes?month=" + month, []);
  const [open, setOpen] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [plan, setPlan] = useState(""),
    [active, setActive] = useState("true");
  const rows = list.data.filter(
    (c: Row) =>
      String(c.active) === active &&
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      (!plan || c.plan === plan),
  );
  return (
    <>
      <div className="toolbar">
        <p className="muted small">Sua carteira, com contexto e histórico.</p>
        <button className="btn" onClick={() => setOpen("")}>
          <Plus size={16} />
          Novo cliente
        </button>
      </div>
      <div className="card">
        <div className="filters">
          <input
            type="search"
            aria-label="Buscar cliente"
            placeholder="Buscar cliente…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Filtrar por plano"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          >
            <option value="">Todos os planos</option>
            {[
              ...new Set(list.data.map((c: Row) => c.plan).filter(Boolean)),
            ].map((p) => (
              <option key={String(p)}>{String(p)}</option>
            ))}
          </select>
          <select
            aria-label="Situação dos clientes"
            value={active}
            onChange={(e) => setActive(e.target.value)}
          >
            <option value="true">Ativos</option>
            <option value="false">Arquivados</option>
          </select>
        </div>
        <State loading={list.loading} error={list.error} empty={!rows.length}>
          <ClientTable rows={rows} onOpen={setOpen} />
        </State>
      </div>
      {open !== null && (
        <ClientDrawer
          id={open}
          month={month}
          onClose={() => setOpen(null)}
          onSaved={list.reload}
        />
      )}
    </>
  );
}
export function ClientDrawer({
  id,
  month,
  onClose,
  onSaved,
}: {
  id: string;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detail = useData(
      id ? "/admin/clientes/" + id + "?month=" + month : null,
      null,
    ),
    cat = useData("/public/catalogo", { plans: [] });
  const [tab, setTab] = useState(id ? "overview" : "edit");
  const { run, notify } = useApp();
  const c = detail.data;
  const save = () => {
    onSaved();
    detail.reload();
  };
  const edit = useSubmit(async (form) => {
    const d = formObject(form);
    const body = { ...d, partners: Number(d.partners) };
    if (id) {
      await api("/admin/clientes/" + id, "PATCH", body);
      notify("Cadastro atualizado.");
      save();
      setTab("overview");
    } else {
      await api("/admin/clientes", "POST", body);
      notify("Cliente cadastrado.");
      onSaved();
      onClose();
    }
  });
  const contract = useSubmit(async (form) => {
    await api("/admin/clientes/" + id + "/contratos", "POST", formObject(form));
    notify("Contrato salvo. Meses anteriores foram preservados.");
    save();
  });
  const [selectedPlan, setSelectedPlan] = useState("MEI Essencial"),
    [amount, setAmount] = useState("130");
  return (
    <Modal title={id ? "Ficha do cliente" : "Novo cliente"} onClose={onClose}>
      <State loading={!!id && detail.loading} error={detail.error}>
        {(c || !id) && (
          <>
            <div>
              <h2>{c?.name || "Um novo começo"}</h2>
              {c && (
                <p className="muted small">
                  {c.plan || "Contrato a definir"} · desde{" "}
                  {monthLabel(c.since_month)}
                </p>
              )}
            </div>
            {id && (
              <div className="tabs">
                {[
                  ["overview", "Visão geral"],
                  ["edit", "Cadastro"],
                  ["contract", "Plano e honorário"],
                  ["documents", "Documentos"],
                  ["reports", "Apuração e relatórios"],
                  ["vault", "Cofre de acessos"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={tab === key ? "active" : ""}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            {tab === "edit" && (
              <form className="stack" key={id || "new"} {...edit}>
                <Field label="Nome do cliente ou empresa">
                  <input
                    type="text"
                    name="name"
                    required
                    maxLength={80}
                    defaultValue={c?.name}
                  />
                </Field>
                <Field label="Razão social">
                  <input
                    type="text"
                    name="legal_name"
                    maxLength={160}
                    defaultValue={c?.legal_name || ""}
                  />
                </Field>
                <div className="fields">
                  <Field label="CNPJ">
                    <input
                      type="text"
                      name="cnpj"
                      maxLength={18}
                      defaultValue={c?.cnpj || ""}
                      placeholder="00.000.000/0001-00"
                    />
                  </Field>
                  <Field label="Inscrição municipal">
                    <input
                      type="text"
                      name="municipal_registration"
                      maxLength={40}
                      defaultValue={c?.municipal_registration || ""}
                    />
                  </Field>
                  <Field label="Cidade">
                    <input
                      type="text"
                      name="city"
                      maxLength={80}
                      defaultValue={c?.city || ""}
                    />
                  </Field>
                  <Field label="UF">
                    <input
                      type="text"
                      name="state"
                      maxLength={2}
                      defaultValue={c?.state || ""}
                      placeholder="RS"
                      style={{ textTransform: "uppercase" }}
                      onInput={(e) =>
                        (e.currentTarget.value =
                          e.currentTarget.value.toUpperCase())
                      }
                    />
                  </Field>
                  <Field label="Telefone do cliente">
                    <input
                      type="tel"
                      name="phone"
                      maxLength={20}
                      defaultValue={c?.phone || ""}
                    />
                  </Field>
                </div>
                <Field label="E-mail de contato (não cria acesso automaticamente)">
                  <input
                    type="email"
                    name="email"
                    defaultValue={c?.email || ""}
                  />
                </Field>
                <div className="fields">
                  <Field label="Enquadramento">
                    <select name="type" defaultValue={c?.type || "MEI"}>
                      <option>MEI</option>
                      <option value="ME">Empresa no Simples Nacional</option>
                    </select>
                  </Field>
                  <Field label="Atividade">
                    <select
                      name="activity"
                      defaultValue={c?.activity || "servicos"}
                    >
                      <option value="servicos">Serviços</option>
                      <option value="comercio">Comércio</option>
                      <option value="ambos">Comércio e serviços</option>
                    </select>
                  </Field>
                  <Field label="Número de sócios">
                    <input
                      type="number"
                      name="partners"
                      min="0"
                      max="100"
                      defaultValue={c?.partners || 0}
                    />
                  </Field>
                  <Field label="Cliente desde">
                    <input
                      type="month"
                      name="since_month"
                      required
                      defaultValue={c?.since_month || month}
                    />
                  </Field>
                  <Field label="Abertura do CNPJ">
                    <input
                      type="month"
                      name="opening_month"
                      defaultValue={c?.opening_month || ""}
                    />
                  </Field>
                </div>
                {!id && (
                  <div className="fields">
                    <Field label="Plano inicial">
                      <select
                        name="plan"
                        value={selectedPlan}
                        onChange={(e) => {
                          setSelectedPlan(e.target.value);
                          setAmount(
                            cat.data.plans.find(
                              (p: Row) => p.code === e.target.value,
                            )?.amount || "0",
                          );
                        }}
                      >
                        {cat.data.plans.map((p: Row) => (
                          <option key={p.code}>{p.code}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Honorário mensal (R$)">
                      <input
                        type="number"
                        name="amount"
                        required
                        min="0"
                        step=".01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </Field>
                    <Field label="Início do contrato">
                      <input
                        type="month"
                        name="effective"
                        required
                        defaultValue={month}
                      />
                    </Field>
                  </div>
                )}
                <Field label="Pasta no Google Drive (opcional)">
                  <input
                    type="url"
                    name="drive"
                    placeholder="https://drive.google.com/…"
                    defaultValue={c?.drive || ""}
                  />
                </Field>
                <Field label="Observações internas">
                  <textarea
                    name="notes"
                    maxLength={600}
                    defaultValue={c?.notes || ""}
                  />
                </Field>
                <p className="hint">
                  Observações são privadas da gestão e cifradas. Use a aba Cofre
                  de acessos para guardar senhas, códigos e certificados.
                </p>
                <div>
                  <Submit busy={edit.busy}>Salvar cadastro</Submit>
                </div>
              </form>
            )}
            {id && tab === "documents" && (
              <Documents admin month={month} clientId={id} />
            )}
            {id && tab === "reports" && (
              <ReportsPanel admin clientId={id} month={month} onSaved={save} />
            )}
            {id && tab === "vault" && <VaultPanel clientId={id} />}
            {id && tab === "contract" && (
              <>
                <form className="card" {...contract}>
                  <h3>Alterar plano ou honorário</h3>
                  <Field label="Plano">
                    <select name="plan" defaultValue={c.plan}>
                      {cat.data.plans.map((p: Row) => (
                        <option key={p.code}>{p.code}</option>
                      ))}
                    </select>
                  </Field>
                  <div className="fields">
                    <Field label="Valor mensal (R$)">
                      <input
                        name="amount"
                        type="number"
                        min="0"
                        step=".01"
                        required
                        defaultValue={c.amount}
                      />
                    </Field>
                    <Field label="Válido a partir de">
                      <input
                        name="effective"
                        type="month"
                        defaultValue={month}
                        required
                      />
                    </Field>
                  </div>
                  <p className="hint">
                    Competências anteriores e recebimentos confirmados são
                    preservados. A alteração afeta cobranças em aberto a partir
                    da vigência escolhida.
                  </p>
                  <Submit busy={contract.busy}>Salvar nova vigência</Submit>
                </form>
                <div className="card">
                  <h3>Histórico contratual</h3>
                  <div className="list">
                    {c.contracts.map((r: Row) => (
                      <div key={r.effective}>
                        <span>
                          {monthLabel(r.effective)}
                          <br />
                          <span className="muted small">{r.plan}</span>
                        </span>
                        <strong>{money(r.amount)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {id && tab === "overview" && (
              <>
                <div className="row">
                  <button className="btn sm" onClick={() => setTab("reports")}>
                    Apurar mês e gerar relatórios
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => setTab("documents")}
                  >
                    Documentos do cliente
                  </button>
                </div>
                <div className="card">
                  <div className="detail-list">
                    <div>
                      <span>Enquadramento</span>
                      <strong>
                        {c.type === "MEI" ? "MEI" : "Simples Nacional"}
                      </strong>
                    </div>
                    <div>
                      <span>Honorário mensal</span>
                      <strong>{money(c.amount)}</strong>
                    </div>
                    <div>
                      <span>Faturamento no ano</span>
                      <strong>{money(c.indicators.annual)}</strong>
                    </div>
                    <div>
                      <span>
                        {c.type === "MEI"
                          ? "Limite do ano"
                          : "Receita de 12 meses"}
                      </span>
                      <strong>
                        {c.type === "MEI"
                          ? c.indicators.limit === null
                            ? "A definir"
                            : money(c.indicators.limit)
                          : c.indicators.rbt === null
                            ? "Sem lançamentos"
                            : money(c.indicators.rbt)}
                      </strong>
                    </div>
                  </div>
                  {c.notes && <p className="small prewrap muted">{c.notes}</p>}
                  {c.drive && (
                    <a
                      href={c.drive}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="small"
                    >
                      Abrir pasta no Drive <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
                <div className="card">
                  <h3>Rotina de {monthLabel(month)}</h3>
                  <div className="list">
                    {c.tasks.map((t: Row) => (
                      <div key={t.key}>
                        <span className="small">
                          {t.name}
                          {t.deadline && <p className="muted">{t.deadline}</p>}
                        </span>
                        <button
                          className={"check-button " + (t.done ? "done" : "")}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/admin/clientes/${id}/competencias/${month}`,
                                "PATCH",
                                { tasks: { [t.key]: !t.done } },
                              );
                              save();
                            })
                          }
                        >
                          {t.done ? <Check size={13} /> : <Clock3 size={13} />}
                          {t.done ? "Feito" : "A fazer"}
                        </button>
                      </div>
                    ))}
                  </div>
                  {["MEI Pro", "MEI Growth"].includes(c.plan) && (
                    <div className="row between">
                      <span className="small">Notas emitidas no mês</span>
                      <div className="number-control">
                        <button
                          className="btn sm ghost"
                          disabled={c.notes_count === 0}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/admin/clientes/${id}/competencias/${month}`,
                                "PATCH",
                                { notes_delta: -1 },
                              );
                              save();
                            })
                          }
                        >
                          −
                        </button>
                        <strong>
                          {c.notes_count}
                          {c.notes_meta ? ` / ${c.notes_meta.included}` : ""}
                        </strong>
                        <button
                          className="btn sm ghost"
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/admin/clientes/${id}/competencias/${month}`,
                                "PATCH",
                                { notes_delta: 1 },
                              );
                              save();
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )}
                  {c.notes_meta?.extra > 0 && (
                    <p className="hint">
                      {c.notes_meta.extra} notas adicionais · referência de{" "}
                      {money(c.notes_meta.reference_total)}. A cobrança é
                      confirmada pela gestão.
                    </p>
                  )}
                </div>
                <RevenueChart c={c} month={month} />
                {c.type === "ME" && (
                  <div className="card">
                    <h3>Entrada do cliente</h3>
                    {[
                      ["emissor", "Configuração do Emissor Nacional"],
                      ["treino", "Treinamento de 30 minutos"],
                      ["pdf", "Passo a passo em PDF enviado"],
                    ].map(([key, label]) => (
                      <button
                        className={
                          "check-button " + (c.onboarding[key] ? "done" : "")
                        }
                        key={key}
                        onClick={() =>
                          void run(async () => {
                            await api("/admin/clientes/" + id, "PATCH", {
                              onboarding: { [key]: !c.onboarding[key] },
                            });
                            save();
                          })
                        }
                      >
                        {c.onboarding[key] && <Check size={14} />}
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="card danger-zone">
                  <h3>Situação do contrato</h3>
                  {c.deletion_pending && (
                    <p className="banner">
                      Exclusão pendente de arquivos. O acesso já foi revogado.
                      Repita a exclusão após resolver o armazenamento.
                    </p>
                  )}
                  <div className="row">
                    <button
                      className="btn ghost sm"
                      onClick={() =>
                        void run(async () => {
                          await api("/admin/clientes/" + id, "PATCH", {
                            active: !c.active,
                          });
                          notify(
                            c.active
                              ? "Cliente arquivado; acessos revogados."
                              : "Cliente reativado.",
                          );
                          onSaved();
                          onClose();
                        })
                      }
                    >
                      {c.active ? "Arquivar cliente" : "Reativar cliente"}
                    </button>
                    <button
                      className="btn danger sm"
                      onClick={() => {
                        if (
                          prompt(
                            "Esta ação exclui dados e documentos. Digite EXCLUIR para confirmar:",
                          ) === "EXCLUIR"
                        )
                          void run(async () => {
                            await api("/admin/clientes/" + id, "DELETE", {
                              confirmation: "EXCLUIR",
                            });
                            notify(
                              "Dados e documentos excluídos. Backups seguem o prazo de retenção.",
                            );
                            onSaved();
                            onClose();
                          });
                      }}
                    >
                      Excluir definitivamente
                    </button>
                  </div>
                  <p className="hint">
                    Arquivar preserva o histórico e impede o acesso do cliente.
                    Exclusão definitiva remove os dados ativos; cópias de
                    segurança expiram conforme a retenção.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </State>
    </Modal>
  );
}
export function Checklist({ month }: { month: string }) {
  const list = useData("/admin/clientes?month=" + month, []);
  const { run } = useApp();
  const rows = list.data.filter((c: Row) => c.active && c.tasks.length);
  const total = rows.reduce((n: number, c: Row) => n + c.tasks.length, 0),
    done = rows.reduce(
      (n: number, c: Row) => n + c.tasks.filter((t: Row) => t.done).length,
      0,
    );
  return (
    <>
      <div className="row between">
        <p className="muted small">
          Marque etapas concluídas ou reabra tarefas quando necessário.
        </p>
        <Badge tone="ok">
          {done} de {total} concluídas
        </Badge>
      </div>
      <div className="bar">
        <i style={{ width: (total ? (done / total) * 100 : 0) + "%" }} />
      </div>
      <State loading={list.loading} error={list.error} empty={!rows.length}>
        {rows.map((c: Row) => (
          <div className="card" key={c.id}>
            <div className="toolbar">
              <h3>{c.name}</h3>
              <span className="small muted">{c.plan}</span>
            </div>
            <div className="row">
              {c.tasks.map((t: Row) => (
                <button
                  key={t.key}
                  className={"check-button " + (t.done ? "done" : "")}
                  onClick={() =>
                    void run(async () => {
                      await api(
                        `/admin/clientes/${c.id}/competencias/${month}`,
                        "PATCH",
                        { tasks: { [t.key]: !t.done } },
                      );
                      list.reload();
                    })
                  }
                >
                  {t.done ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
                  <span>
                    {t.name}
                    {t.deadline && (
                      <span className="muted"> · {t.deadline}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </State>
    </>
  );
}
export function Fees({ month }: { month: string }) {
  const list = useData("/admin/honorarios?month=" + month, []);
  const { run, notify } = useApp();
  const total = sum(list.data, "amount"),
    paid = sum(
      list.data.filter((f: Row) => f.paid),
      "amount",
    );
  return (
    <>
      <div className="grid">
        <Stat
          label="Previsto na competência"
          value={money(total)}
          detail={`${list.data.length} honorários registrados`}
        />
        <Stat
          label="Recebido"
          value={money(paid)}
          detail={
            total
              ? `${Math.round((paid / total) * 100)}% confirmado`
              : "Sem cobranças"
          }
        />
        <Stat
          label="Em aberto"
          value={money(total - paid)}
          alert={total > paid}
        />
      </div>
      <State
        loading={list.loading}
        error={list.error}
        empty={!list.data.length}
      >
        <div className="card">
          <h3>Recebimentos por cliente</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Plano da competência</th>
                  <th className="r">Honorário</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((f: Row) => (
                  <tr key={f.client_id}>
                    <td>
                      <strong>{f.name}</strong>
                      {!f.active && <p className="muted">Cliente arquivado</p>}
                    </td>
                    <td>{f.plan}</td>
                    <td className="r num">{money(f.amount)}</td>
                    <td>
                      <button
                        className={"pill " + (f.paid ? "ok" : "alert")}
                        aria-pressed={f.paid}
                        onClick={() =>
                          void run(async () => {
                            await api(
                              `/admin/honorarios/${f.client_id}/${month}`,
                              "PATCH",
                              { paid: !f.paid },
                            );
                            notify("Recebimento atualizado.");
                            list.reload();
                          })
                        }
                      >
                        {f.paid ? "Recebido" : "Em aberto"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>Por plano</h3>
          <div className="list">
            {[...new Set(list.data.map((f: Row) => f.plan))].map((p) => (
              <div key={String(p)}>
                <span>
                  {String(p)}
                  <br />
                  <span className="small muted">
                    {list.data.filter((f: Row) => f.plan === p).length} clientes
                  </span>
                </span>
                <strong>
                  {money(
                    sum(
                      list.data.filter((f: Row) => f.plan === p),
                      "amount",
                    ),
                  )}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </State>
    </>
  );
}
