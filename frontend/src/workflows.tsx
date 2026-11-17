import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileText,
  Send,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api, money, date, monthNow, monthLabel } from "./api";
import { Footer } from "./branding";
import { KanbanOrders } from "./kanban";
import {
  useData,
  useApp,
  Field,
  Submit,
  State,
  Badge,
  Stat,
  useSubmit,
  formObject,
  type Row,
} from "./ui";
export function ServicePicker({
  services,
  selected,
  onSelect,
}: {
  services: Row[];
  selected: string;
  onSelect: (s: string) => void;
}) {
  const groups = [...new Set(services.map((s) => s.category))].sort(
    (a, b) =>
      ["MEI", "Empresas", "Consultoria e planejamento"].indexOf(a) -
      ["MEI", "Empresas", "Consultoria e planejamento"].indexOf(b),
  );
  return (
    <>
      {groups.map((group) => (
        <div key={group}>
          <p className="eyebrow" style={{ margin: "8px 0" }}>
            {group}
          </p>
          {services
            .filter((s) => s.category === group)
            .map((s) => (
              <label className="serv" key={s.code}>
                <input
                  type="radio"
                  name="service_code"
                  value={s.code}
                  required
                  checked={selected === s.code}
                  onChange={() => onSelect(s.code)}
                />
                <span>
                  <b>{s.name}</b>
                  <br />
                  <span className="small muted">{s.description}</span>
                </span>
                <span className="pr">{s.price_label}</span>
              </label>
            ))}
        </div>
      ))}
    </>
  );
}
export function PublicRequest() {
  const c = useData("/public/catalogo", {
    services: [],
    plans: [],
    contact: {},
  });
  const { notify, user, run } = useApp();
  const [selected, setSelected] = useState(""),
    [details, setDetails] = useState({
      name: "",
      email: "",
      business: "",
      declared_plan: "Ainda não sou cliente",
      details: "",
    }),
    [sent, setSent] = useState("");
  const service = c.data.services.find((s: Row) => s.code === selected);
  const text =
    service && details.name
      ? `Olá, GB Soluções. Gostaria de solicitar um serviço.\n\nServiço: ${service.name} (referência: ${service.price_label})\nNome: ${details.name}\nNegócio: ${details.business}\nPlano atual: ${details.declared_plan}\nDetalhes: ${details.details}`
      : "";
  const submit = useSubmit(async () => {
    const result = await api("/public/pedidos", "POST", {
      ...details,
      service_code: selected,
    });
    setSent(result.id);
    notify("Solicitação recebida pela GB Soluções.");
  });
  const input = (key: keyof typeof details) => ({
    value: details[key],
    onChange: (e: any) => setDetails({ ...details, [key]: e.target.value }),
  });
  return (
    <div className="pub">
      <nav className="public-nav">
        <span>GB SOLUÇÕES</span>
        <Link
          to={user ? (user.role === "admin" ? "/admin" : "/portal") : "/login"}
        >
          {user ? "Acessar meu painel" : "Área do cliente"}{" "}
          <ArrowUpRight size={14} />
        </Link>
      </nav>
      <header>
        <img src="/logo.jpg" alt="GB Soluções | Gestão Empresarial" />
        <p className="eyebrow">GB Soluções | Gestão Empresarial</p>
        <h1>Solicitar serviço</h1>
        <hr className="rule" />
        <p className="muted">
          Escolha o que você precisa e envie o pedido.
          <br />A GB confirma o valor e o prazo antes de começar.
        </p>
      </header>
      <State loading={c.loading} error={c.error}>
        {sent ? (
          <div className="card public-confirm">
            <h3>Seu pedido chegou à GB.</h3>
            <p className="muted">
              Vamos conversar pelo e-mail informado para confirmar valor e
              prazo.
            </p>
            <p className="small">Protocolo: {sent.slice(0, 8).toUpperCase()}</p>
            <button
              className="btn ghost"
              onClick={() => {
                setSent("");
                setSelected("");
              }}
            >
              Fazer outro pedido
            </button>
          </div>
        ) : (
          <form className="stack" {...submit}>
            <section className="card">
              <div className="step-heading">
                <span className="step-number">1</span>
                <h3>Escolha o serviço</h3>
              </div>
              <ServicePicker
                services={c.data.services}
                selected={selected}
                onSelect={setSelected}
              />
              <p className="hint">
                Taxas públicas, débitos, multas e serviços de terceiros não
                estão incluídos. Débitos são pagos pelo próprio cliente.
              </p>
            </section>
            <section className="card">
              <div className="step-heading">
                <span className="step-number">2</span>
                <h3>Conte o que você precisa</h3>
              </div>
              <div className="fields">
                <Field label="Seu nome">
                  <input
                    type="text"
                    required
                    maxLength={80}
                    {...input("name")}
                  />
                </Field>
                <Field label="Seu e-mail">
                  <input
                    type="email"
                    required
                    maxLength={254}
                    {...input("email")}
                  />
                </Field>
                <Field label="Nome do negócio (opcional)">
                  <input type="text" maxLength={80} {...input("business")} />
                </Field>
                <Field label="Seu plano na GB">
                  <select {...input("declared_plan")}>
                    <option>Ainda não sou cliente</option>
                    {c.data.plans
                      .filter(
                        (p: Row) =>
                          !["BPO Financeiro", "Avulso"].includes(p.code),
                      )
                      .map((p: Row) => (
                        <option key={p.code}>{p.code}</option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label="Detalhes">
                <textarea
                  maxLength={500}
                  placeholder="Ex.: preciso emitir uma nota até sexta."
                  {...input("details")}
                />
              </Field>
              <p className="hint">
                Informe apenas os dados necessários ao atendimento. Não envie
                senhas ou credenciais de acesso.
              </p>
            </section>
            <section className="card">
              <div className="step-heading">
                <span className="step-number">3</span>
                <h3>Envie para a GB</h3>
              </div>
              <div className="previa">
                {text ||
                  "Escolha o serviço e informe seu nome para ver a mensagem."}
              </div>
              <div className="row">
                <Submit busy={submit.busy}>
                  <Send size={15} />
                  Enviar solicitação
                </Submit>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    void run(async () => {
                      if (!text)
                        throw new Error(
                          "Escolha o serviço e informe seu nome.",
                        );
                      await navigator.clipboard.writeText(text);
                      notify("Mensagem copiada.");
                    })
                  }
                >
                  <Copy size={14} />
                  Copiar mensagem
                </button>
                {c.data.contact.whatsapp && (
                  <a
                    className="btn ghost"
                    href={
                      "https://wa.me/" +
                      c.data.contact.whatsapp +
                      "?text=" +
                      encodeURIComponent(text)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    WhatsApp
                  </a>
                )}
                <a
                  href={c.data.contact.instagram}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="small"
                >
                  Instagram <ArrowUpRight size={14} />
                </a>
              </div>
            </section>
          </form>
        )}
        <section className="card">
          <h3>Prefere conversar antes?</h3>
          <p className="muted small">
            Agende uma Conversa de Clareza de 30 minutos para entender o melhor
            caminho para o seu negócio.
          </p>
          <div>
            <a
              className="btn ghost"
              href={c.data.contact.agenda}
              target="_blank"
              rel="noopener noreferrer"
            >
              Agendar Conversa de Clareza <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
      </State>
      <Footer />
    </div>
  );
}
export function Orders({
  month,
  admin = false,
}: {
  month: string;
  admin?: boolean;
}) {
  return admin ? (
    <KanbanOrders month={month} />
  ) : (
    <CustomerOrders month={month} />
  );
}
function CustomerOrders({
  month,
  admin = false,
}: {
  month: string;
  admin?: boolean;
}) {
  const list = useData(
    admin ? "/admin/pedidos?month=" + month : "/me/pedidos",
    [],
  );
  const cat = useData("/public/catalogo", { services: [] });
  const clients = useData(admin ? "/admin/clientes?month=" + month : null, []);
  const { run, notify } = useApp();
  const [service, setService] = useState(""),
    [value, setValue] = useState("");
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    await api(
      admin ? "/admin/pedidos" : "/me/pedidos",
      "POST",
      admin ? { ...d, amount: d.amount === "" ? null : d.amount } : d,
    );
    notify("Solicitação registrada.");
    form.reset();
    setService("");
    setValue("");
    list.reload();
  });
  const update = async (id: string, data: Row) => {
    await api("/admin/pedidos/" + id, "PATCH", data);
    list.reload();
    notify("Solicitação atualizada.");
  };
  return (
    <>
      <div className="grid">
        <Stat
          label="Em aberto"
          value={list.data.filter((p: Row) => p.status !== "Cobrada").length}
          detail="Do recebimento à conclusão"
        />
        <Stat
          label="Concluídas a cobrar"
          value={money(
            list.data
              .filter((p: Row) => p.status === "Concluída")
              .reduce((s: number, p: Row) => s + Number(p.amount || 0), 0),
          )}
        />
        <Stat
          label="Solicitações no mês"
          value={list.data.filter((p: Row) => p.date?.startsWith(month)).length}
        />
      </div>
      <form className="card" {...submit}>
        <h3>{admin ? "Registrar solicitação" : "O que você precisa?"}</h3>
        <div className="fields">
          {admin && (
            <Field label="Cliente">
              <select name="client_id" required>
                <option value="">Selecione</option>
                {clients.data
                  .filter((c: Row) => c.active)
                  .map((c: Row) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Field label="Serviço">
            <select
              name="service_code"
              required
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                setValue(
                  cat.data.services.find((s: Row) => s.code === e.target.value)
                    ?.amount || "",
                );
              }}
            >
              <option value="">Selecione o serviço</option>
              {cat.data.services.map((s: Row) => (
                <option key={s.code} value={s.code}>
                  {s.name} · {s.price_label}
                </option>
              ))}
            </select>
          </Field>
          {admin && (
            <>
              <Field label="Valor combinado (R$)">
                <input
                  name="amount"
                  type="number"
                  min="0"
                  step=".01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Sob consulta"
                />
              </Field>
              <Field label="Data">
                <input
                  name="date"
                  type="date"
                  defaultValue={new Intl.DateTimeFormat("sv-SE", {
                    timeZone: "America/Sao_Paulo",
                  }).format(new Date())}
                  required
                />
              </Field>
            </>
          )}
        </div>
        <Field label="Detalhes">
          <textarea name="details" maxLength={500} />
        </Field>
        <div>
          <Submit busy={submit.busy}>Registrar solicitação</Submit>
        </div>
        {!admin && (
          <p className="hint">
            Valor e prazo serão confirmados pela equipe GB antes do início.
          </p>
        )}
      </form>
      <State
        loading={list.loading}
        error={list.error}
        empty={!list.data.length}
      >
        <div className="card">
          <h3>{admin ? "Em aberto e cobradas no mês" : "Meus pedidos"}</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Data / cliente</th>
                  <th>Serviço</th>
                  <th>Valor</th>
                  <th>Situação</th>
                  {admin && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {list.data.map((p: Row) => (
                  <tr key={p.id}>
                    <td>
                      {date(p.date)}
                      {admin && (
                        <>
                          <br />
                          <strong>{p.client_name || p.contact_name}</strong>
                          {!p.client_id && (
                            <>
                              <br />
                              <span className="muted">
                                Interessado · {p.contact_email}
                              </span>
                              <select
                                aria-label="Vincular a cliente"
                                className="small-input"
                                value=""
                                onChange={(e) =>
                                  e.target.value &&
                                  void run(() =>
                                    update(p.id, { client_id: e.target.value }),
                                  )
                                }
                              >
                                <option value="">Vincular cliente…</option>
                                {clients.data
                                  .filter((c: Row) => c.active)
                                  .map((c: Row) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                            </>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <strong>{p.service_name}</strong>
                      {p.details && (
                        <p className="muted prewrap">{p.details}</p>
                      )}
                    </td>
                    <td>
                      {admin ? (
                        <input
                          aria-label={"Valor de " + p.service_name}
                          key={p.amount}
                          className="small-input"
                          type="number"
                          min="0"
                          step=".01"
                          defaultValue={p.amount ?? ""}
                          placeholder="A confirmar"
                          onBlur={(e) => {
                            const v = e.target.value;
                            if (v !== String(p.amount ?? ""))
                              void run(() =>
                                update(p.id, { amount: v === "" ? null : v }),
                              );
                          }}
                        />
                      ) : p.amount !== null ? (
                        money(p.amount)
                      ) : (
                        "A confirmar"
                      )}
                    </td>
                    <td>
                      {admin ? (
                        <select
                          aria-label="Situação do pedido"
                          value={p.status}
                          onChange={(e) =>
                            void run(() =>
                              update(p.id, { status: e.target.value }),
                            )
                          }
                        >
                          {[
                            "Recebida",
                            "Em andamento",
                            "Concluída",
                            "Cobrada",
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <Badge tone={p.status === "Concluída" ? "ok" : "wait"}>
                          {p.status}
                        </Badge>
                      )}
                    </td>
                    {admin && (
                      <td>
                        <button
                          className="table-action"
                          onClick={() => {
                            if (
                              confirm(
                                "Excluir esta solicitação definitivamente?",
                              )
                            )
                              void run(async () => {
                                await api("/admin/pedidos/" + p.id, "DELETE");
                                list.reload();
                              });
                          }}
                        >
                          Excluir
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </State>
    </>
  );
}
export function Documents({
  month,
  admin = false,
  upload = false,
  clientId,
}: {
  month: string;
  admin?: boolean;
  upload?: boolean;
  clientId?: string;
}) {
  const list = useData(
    "/documentos" + (clientId ? "?client_id=" + clientId : ""),
    [],
  );
  const clients = useData(admin ? "/admin/clientes?month=" + month : null, []);
  const { run, notify } = useApp();
  const [filter, setFilter] = useState("");
  const submit = useSubmit(async (form) => {
    const body = new FormData(form);
    if (!admin) body.set("category", "Extratos");
    await api("/documentos", "POST", body);
    notify("Arquivo armazenado com segurança.");
    form.reset();
    list.reload();
  });
  const rows = list.data.filter((d: Row) => !filter || d.client_id === filter);
  return (
    <>
      {(admin || upload) && (
        <form className="card" {...submit}>
          <h3>{admin ? "Publicar documento" : "Enviar extrato bancário"}</h3>
          <div className="fields">
            {admin && !clientId && (
              <Field label="Cliente">
                <select name="client_id" required>
                  <option value="">Selecione</option>
                  {clients.data
                    .filter((c: Row) => c.active)
                    .map((c: Row) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            {admin && clientId && (
              <input type="hidden" name="client_id" value={clientId} />
            )}
            <Field label="Título">
              <input
                name="title"
                type="text"
                required
                maxLength={120}
                placeholder={
                  upload
                    ? "Ex.: Extrato da conta PJ"
                    : "Ex.: Guia DAS de novembro"
                }
              />
            </Field>
            <Field label="Competência">
              <input name="month" type="month" defaultValue={month} required />
            </Field>
            {admin ? (
              <Field label="Categoria">
                <select name="category">
                  {[
                    "Guias",
                    "Relatórios",
                    "Declarações",
                    "Cadastro",
                    "Extratos",
                    "Outros",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label="Conta (identificação simples)">
                <input
                  name="account"
                  type="text"
                  maxLength={80}
                  placeholder="Ex.: conta PJ principal"
                />
              </Field>
            )}
          </div>
          <div className="drop">
            <UploadCloud size={27} color="var(--sage)" />
            <Field label="Arquivo — PDF, OFX, CSV, JPEG ou PNG, até 10 MB">
              <input
                name="file"
                type="file"
                accept=".pdf,.ofx,.csv,.jpg,.jpeg,.png"
                required
              />
            </Field>
          </div>
          <p className="upload-hint muted">
            O arquivo será enviado ao armazenamento privado da GB. Não envie
            senhas, certificados digitais privados ou credenciais bancárias.
          </p>
          <div>
            <Submit busy={submit.busy}>Enviar documento</Submit>
          </div>
        </form>
      )}
      <State loading={list.loading} error={list.error}>
        <div className="card">
          <div className="toolbar">
            <h3>{upload ? "Meus envios" : "Documentos disponíveis"}</h3>
            {admin && !clientId && (
              <select
                aria-label="Filtrar documentos por cliente"
                className="small-input"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">Todos os clientes</option>
                {clients.data.map((c: Row) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {!rows.length ? (
            <p className="muted">Nenhum documento disponível.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Documento</th>
                    {admin && <th>Cliente</th>}
                    <th>Tipo / competência</th>
                    <th>Enviado em</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((d: Row) => !upload || d.category === "Extratos")
                    .map((d: Row) => (
                      <tr key={d.id}>
                        <td>
                          <strong>{d.title}</strong>
                          <p className="muted">
                            {d.filename} · {(d.size / 1024).toFixed(0)} KB
                          </p>
                          {d.account && <p className="muted">{d.account}</p>}
                        </td>
                        {admin && <td>{d.client_name}</td>}
                        <td>
                          <Badge tone="na">{d.category}</Badge>
                          <p className="muted">{monthLabel(d.month)}</p>
                        </td>
                        <td>{date(d.created_at)}</td>
                        <td>
                          <a
                            href={"/api/documentos/" + d.id + "/download"}
                            className="small"
                          >
                            <Download size={14} />
                            Baixar
                          </a>
                          {admin && (
                            <button
                              className="table-action"
                              style={{ marginLeft: 12 }}
                              onClick={() => {
                                if (
                                  confirm(
                                    "Excluir este arquivo do armazenamento?",
                                  )
                                )
                                  void run(async () => {
                                    await api("/documentos/" + d.id, "DELETE");
                                    list.reload();
                                    notify("Documento excluído.");
                                  });
                              }}
                            >
                              Excluir
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </State>
    </>
  );
}
export function Revenue({
  month,
  admin = false,
}: {
  month: string;
  admin?: boolean;
}) {
  const list = useData(
    admin ? "/admin/clientes?month=" + month : "/me?month=" + month,
    admin ? [] : null,
  );
  const reviews = useData(
    admin ? "/admin/faturamentos/revisoes" : "/me/faturamentos",
    [],
  );
  const { run, notify } = useApp();
  const [showAll, setShowAll] = useState(false);
  const submit = useSubmit(async (form) => {
    await api("/me/faturamentos", "POST", formObject(form));
    notify("Faturamento enviado para revisão da gestora.");
    reviews.reload();
    form.reset();
  });
  const pending = reviews.data.filter(
    (r: Row) => showAll || r.status === "Pendente",
  );
  return (
    <>
      {!admin && (
        <form className="card" {...submit}>
          <h3>Informe seu faturamento</h3>
          <p className="muted small">
            O valor passará por revisão da gestora antes de atualizar os
            indicadores. Um novo envio preserva o último valor aprovado.
          </p>
          <div className="fields">
            <Field label="Competência">
              <input
                type="month"
                name="month"
                defaultValue={month}
                max={monthNow()}
                required
              />
            </Field>
            <Field label="Faturamento bruto (R$)">
              <input name="amount" type="number" step=".01" min="0" required />
            </Field>
          </div>
          <div>
            <Submit busy={submit.busy}>Enviar para revisão</Submit>
          </div>
        </form>
      )}
      <State loading={list.loading} error={list.error}>
        <div className="card">
          <h3>
            {admin
              ? "Faturamento aprovado da carteira"
              : "Meu faturamento aprovado"}
          </h3>
          {admin ? (
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>No mês (R$)</th>
                    <th>No ano</th>
                    <th>Indicador</th>
                    <th>Projeção / RBT12</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data
                    .filter((c: Row) => c.active)
                    .map((c: Row) => {
                      const value = c.revenues.find(
                        (r: Row) => r.month === month,
                      )?.amount;
                      return (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.name}</strong>
                            <p className="muted">{c.plan}</p>
                          </td>
                          <td>
                            <input
                              aria-label={"Faturamento de " + c.name}
                              className="small-input"
                              key={value ?? "empty"}
                              type="number"
                              min="0"
                              step=".01"
                              defaultValue={value ?? ""}
                              placeholder="Não informado"
                              onBlur={(e) => {
                                const amount = e.target.value;
                                if (
                                  amount !== "" &&
                                  Number(amount) !== Number(value ?? -1)
                                )
                                  void run(async () => {
                                    await api(
                                      "/admin/clientes/" +
                                        c.id +
                                        "/faturamentos",
                                      "POST",
                                      { month, amount },
                                    );
                                    list.reload();
                                    reviews.reload();
                                    notify("Faturamento aprovado atualizado.");
                                  });
                              }}
                            />
                          </td>
                          <td>{money(c.indicators.annual)}</td>
                          <td>
                            {c.type === "MEI"
                              ? c.indicators.limit === null
                                ? "A definir"
                                : `${Math.round(c.indicators.use * 100)}% do limite`
                              : c.indicators.band || "A definir"}
                            {c.indicators.alert && (
                              <p>
                                <Badge tone="alert">
                                  Atenção ao faturamento
                                </Badge>
                              </p>
                            )}
                          </td>
                          <td>
                            {c.type === "MEI"
                              ? c.indicators.projection === null
                                ? "Sem lançamentos"
                                : money(c.indicators.projection)
                              : c.indicators.rbt === null
                                ? "Sem lançamentos"
                                : money(c.indicators.rbt)}
                            {c.type === "ME" && c.indicators.estimated && (
                              <p className="muted">
                                Estimativa · {c.indicators.months}/12 meses
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {!list.data.length && (
                <p className="muted">
                  Cadastre o primeiro cliente para começar.
                </p>
              )}
            </div>
          ) : (
            list.data && (
              <div className="scroll compact">
                <table>
                  <thead>
                    <tr>
                      <th>Competência</th>
                      <th>Valor aprovado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.revenues
                      .slice()
                      .sort((a: Row, b: Row) => b.month.localeCompare(a.month))
                      .map((r: Row) => (
                        <tr key={r.month}>
                          <td>{monthLabel(r.month)}</td>
                          <td>{money(r.amount)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          <p className="hint">
            Indicadores são gerenciais. Com menos de 12 meses anteriores, RBT12
            é estimado. O valor oficial é o apurado no PGDAS-D.
          </p>
        </div>
      </State>
      <div className="card">
        <div className="toolbar">
          <h3>{admin ? "Envios para revisão" : "Histórico de envios"}</h3>
          {admin && (
            <label className="small">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />{" "}
              Mostrar revisados
            </label>
          )}
        </div>
        <State
          loading={reviews.loading}
          error={reviews.error}
          empty={!(admin ? pending : reviews.data).length}
        >
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  {admin && <th>Cliente</th>}
                  <th>Competência</th>
                  <th>Informado</th>
                  <th>Revisão</th>
                  <th>Decisão</th>
                </tr>
              </thead>
              <tbody>
                {(admin ? pending : reviews.data).map((r: Row) => (
                  <ReviewRow
                    key={r.id}
                    row={r}
                    admin={admin}
                    onSaved={() => {
                      reviews.reload();
                      list.reload();
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </State>
      </div>
    </>
  );
}
function ReviewRow({
  row: r,
  admin,
  onSaved,
}: {
  row: Row;
  admin: boolean;
  onSaved: () => void;
}) {
  const { run, notify } = useApp();
  const [amount, setAmount] = useState(r.amount),
    [reason, setReason] = useState("");
  const decide = (status: string) =>
    void run(async () => {
      await api("/admin/faturamentos/revisoes/" + r.id, "PATCH", {
        status,
        amount,
        reason,
      });
      notify("Revisão registrada.");
      onSaved();
    });
  return (
    <tr>
      {admin && (
        <td>
          <strong>{r.client_name}</strong>
        </td>
      )}
      <td>
        {monthLabel(r.month)}
        <p className="muted">{date(r.submitted_at)}</p>
      </td>
      <td>{money(r.amount)}</td>
      <td>
        {admin && r.status === "Pendente" ? (
          <>
            <input
              aria-label="Valor aprovado"
              className="small-input"
              type="number"
              min="0"
              step=".01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              type="text"
              maxLength={500}
              placeholder="Observação da revisão"
              aria-label="Observação da revisão"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </>
        ) : (
          <>
            {r.approved_amount !== null ? money(r.approved_amount) : "—"}
            <p className="muted">{r.reason}</p>
          </>
        )}
      </td>
      <td>
        {admin && r.status === "Pendente" ? (
          <div className="row">
            <button className="btn sm" onClick={() => decide("Aprovado")}>
              Aprovar
            </button>
            <button
              className="table-action"
              onClick={() => decide("Rejeitado")}
            >
              Rejeitar
            </button>
          </div>
        ) : (
          <Badge
            tone={
              r.status === "Aprovado"
                ? "ok"
                : r.status === "Rejeitado"
                  ? "alert"
                  : "wait"
            }
          >
            {r.status}
          </Badge>
        )}
      </td>
    </tr>
  );
}
