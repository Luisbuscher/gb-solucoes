import { useState, useEffect } from "react";
import {
  Mail,
  ShieldCheck,
  UserRound,
  Settings2,
  ExternalLink,
} from "lucide-react";
import { api, money, date, monthNow, monthLabel } from "./api";
import {
  useData,
  useApp,
  State,
  Field,
  Submit,
  Badge,
  useSubmit,
  formObject,
  type Row,
} from "./ui";
export function UsersPage() {
  const list = useData("/admin/usuarios", []),
    clients = useData("/admin/clientes", []),
    config = useData("/admin/configuracoes", null);
  const [role, setRole] = useState("cliente");
  const { run, notify, user } = useApp();
  useEffect(() => {
    const timer = setInterval(list.reload, 10000);
    return () => clearInterval(timer);
  }, []);
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    const result = await api("/admin/usuarios", "POST", {
      ...d,
      client_id: role === "cliente" ? d.client_id : null,
    });
    form.reset();
    list.reload();
    notify(
      result.status === "Enviado"
        ? "Convite aceito pelo Resend. O usuário poderá definir a senha pelo link."
        : result.error || "Acesso criado. O convite está na fila de envio.",
    );
  });
  return (
    <>
      {config.data && !config.data.integrations.resend && (
        <p className="banner">
          {config.data.integrations.email?.reason ||
            "O envio de e-mail está pendente de configuração."}{" "}
          Os acessos são criados, mas o convite aguarda a correção.
        </p>
      )}
      {config.data?.integrations.email?.localUrl && (
        <p className="banner">
          Os links dos convites apontam para{" "}
          {config.data.integrations.email.url}. Esse endereço funciona neste
          computador. Para acesso de clientes externos, configure a URL pública
          do sistema.
        </p>
      )}
      <form className="card" {...submit}>
        <h3>Criar acesso</h3>
        <div className="fields">
          <Field label="Nome">
            <input name="name" type="text" required maxLength={80} />
          </Field>
          <Field label="E-mail">
            <input name="email" type="email" required />
          </Field>
          <Field label="Perfil">
            <select
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="cliente">Cliente</option>
              <option value="admin">Administrador</option>
            </select>
          </Field>
          {role === "cliente" && (
            <Field label="Cliente vinculado">
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
        </div>
        <p className="hint">
          O convite permite definir uma senha pessoal e expira em 24 horas.
          Nenhuma senha será enviada por e-mail.
        </p>
        <div>
          <Submit busy={submit.busy}>
            <Mail size={15} />
            Criar e convidar
          </Submit>
        </div>
      </form>
      <State loading={list.loading && !list.data.length} error={list.error}>
        <div className="card">
          <h3>Acessos da plataforma</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Perfil / vínculo</th>
                  <th>Acesso</th>
                  <th>Convite</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((u: Row) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.name}</strong>
                      <p className="muted">{u.email}</p>
                    </td>
                    <td>
                      {u.role === "admin" ? "Administrador" : "Cliente"}
                      <p className="muted">
                        {u.client_name ||
                          (u.primary_admin
                            ? "Administrador primário"
                            : "Acesso à gestão")}
                      </p>
                    </td>
                    <td>
                      <Badge tone={u.active ? "ok" : "alert"}>
                        {u.active ? "Ativo" : "Desativado"}
                      </Badge>
                      {!u.password_defined && (
                        <p className="muted">
                          Aguardando definição de senha pelo convite
                        </p>
                      )}
                    </td>
                    <td>
                      {u.primary_admin
                        ? "Protegido pelo ambiente"
                        : u.delivery === "Enviado"
                          ? "Envio aceito pelo Resend"
                          : u.delivery || "—"}
                      {u.delivery_error && (
                        <p className="delivery-error">{u.delivery_error}</p>
                      )}
                    </td>
                    <td>
                      <div className="row">
                        {!u.primary_admin && u.active && (
                          <button
                            className="table-action"
                            onClick={() =>
                              void run(async () => {
                                const result = await api(
                                  "/admin/usuarios/" + u.id + "/convite",
                                  "POST",
                                );
                                list.reload();
                                notify(
                                  result.status === "Enviado"
                                    ? "Novo convite aceito pelo Resend; o anterior foi invalidado."
                                    : result.error ||
                                        "Novo convite registrado na fila.",
                                );
                              })
                            }
                          >
                            Reenviar convite
                          </button>
                        )}
                        {!u.primary_admin && u.id !== user?.id && (
                          <button
                            className="table-action"
                            onClick={() =>
                              void run(async () => {
                                await api("/admin/usuarios/" + u.id, "PATCH", {
                                  active: !u.active,
                                });
                                list.reload();
                                notify("Situação do acesso atualizada.");
                              })
                            }
                          >
                            {u.active ? "Desativar" : "Ativar"}
                          </button>
                        )}
                      </div>
                    </td>
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
export function Configuration({ month }: { month: string }) {
  const data = useData("/admin/configuracoes", null);
  const [tab, setTab] = useState("plans");
  return (
    <State loading={data.loading} error={data.error}>
      {data.data && (
        <>
          <div className="card">
            <h3>Conexões e entregas</h3>
            <div className="badge-integrations">
              <Badge tone={data.data.integrations.gcs ? "ok" : "wait"}>
                Armazenamento:{" "}
                {data.data.integrations.gcs
                  ? "configurado"
                  : "pendente de configuração"}
              </Badge>
              <Badge tone={data.data.integrations.resend ? "ok" : "wait"}>
                E-mail:{" "}
                {data.data.integrations.resend
                  ? "configurado"
                  : "pendente de configuração"}
              </Badge>
            </div>
            <p className="hint">
              As credenciais são configuradas no ambiente do servidor. Nenhuma
              chave é exibida ou armazenada pelo navegador.
            </p>
          </div>
          <div className="tabs">
            {[
              ["plans", "Planos e honorários"],
              ["services", "Serviços avulsos"],
              ["fiscal", "Parâmetros anuais"],
              ["contact", "Canais de contato"],
            ].map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "plans" && (
            <PlanSettings month={month} data={data.data} reload={data.reload} />
          )}
          {tab === "services" && (
            <ServiceSettings
              month={month}
              data={data.data}
              reload={data.reload}
            />
          )}
          {tab === "fiscal" && (
            <FiscalSettings data={data.data} reload={data.reload} />
          )}
          {tab === "contact" && (
            <ContactSettings data={data.data} reload={data.reload} />
          )}
        </>
      )}
    </State>
  );
}
function PlanSettings({
  data,
  month,
  reload,
}: {
  data: Row;
  month: string;
  reload: () => void;
}) {
  const [code, setCode] = useState(data.plans[0]?.code || "");
  const p = data.plan_versions.find((p: Row) => p.code === code);
  const { notify } = useApp();
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    await api("/admin/configuracoes/planos", "PUT", {
      ...d,
      ceiling: d.ceiling || null,
      partners: d.partners === "" ? null : Number(d.partners),
      hours: d.hours === "" ? null : Number(d.hours),
    });
    notify(
      "Vigência do plano salva. Contratos existentes mantêm seus próprios valores.",
    );
    reload();
  });
  return (
    <>
      <form className="card" key={code + ":" + p?.id} {...submit}>
        <h3>Preços e capacidade dos planos</h3>
        <Field label="Plano">
          <select
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          >
            {data.plans.map((p: Row) => (
              <option key={p.code}>{p.code}</option>
            ))}
          </select>
        </Field>
        <div className="fields">
          <Field label="Vigência a partir de">
            <input
              name="effective"
              type="month"
              defaultValue={month}
              required
            />
          </Field>
          <Field label="Honorário de referência (R$)">
            <input
              name="amount"
              type="number"
              min="0"
              step=".01"
              required
              defaultValue={p?.amount}
            />
          </Field>
          <Field label="Teto mensal do plano (R$)">
            <input
              name="ceiling"
              type="number"
              min="0"
              step=".01"
              defaultValue={p?.ceiling ?? ""}
            />
          </Field>
          <Field label="Sócios incluídos (vazio = sem teto)">
            <input
              name="partners"
              type="number"
              min="0"
              step="1"
              defaultValue={p?.partners ?? ""}
            />
          </Field>
          <Field label="Horas estimadas por mês">
            <input
              name="hours"
              type="number"
              min="0"
              max="744"
              step=".01"
              defaultValue={p?.hours ?? ""}
            />
          </Field>
        </div>
        <p className="hint">
          A referência vale para novos contratos. Para reajustar um cliente,
          registre a vigência na ficha dele. Salvar na mesma vigência corrige
          essa versão.
        </p>
        <div>
          <Submit busy={submit.busy} />
        </div>
      </form>
      <VersionTable
        rows={data.plan_versions.filter((p: Row) => p.code === code)}
      />
    </>
  );
}
function VersionTable({ rows }: { rows: Row[] }) {
  return (
    <div className="card">
      <h3>Vigências registradas</h3>
      <div className="list">
        {rows.map((r: Row) => (
          <div key={r.id}>
            <span>
              {monthLabel(r.effective)}
              <br />
              <span className="small muted">{r.code}</span>
            </span>
            <strong>
              {r.amount === null ? r.price_label : money(r.amount)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}
function ServiceSettings({
  data,
  month,
  reload,
}: {
  data: Row;
  month: string;
  reload: () => void;
}) {
  const [code, setCode] = useState(data.services[0]?.code || "");
  const s = data.service_versions.find((s: Row) => s.code === code);
  const { notify } = useApp();
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    await api("/admin/configuracoes/servicos", "PUT", {
      ...d,
      amount: d.amount || null,
    });
    notify("Serviço salvo. Pedidos anteriores foram preservados.");
    reload();
  });
  return (
    <>
      <form className="card" key={code + ":" + s?.id} {...submit}>
        <h3>Catálogo de serviços</h3>
        <Field label="Serviço">
          <select
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          >
            {data.services.map((s: Row) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="fields">
          <Field label="Vigência">
            <input
              name="effective"
              type="month"
              defaultValue={month}
              required
            />
          </Field>
          <Field label="Grupo">
            <input
              name="category"
              type="text"
              required
              maxLength={80}
              defaultValue={s?.category}
            />
          </Field>
          <Field label="Nome">
            <input
              name="name"
              type="text"
              required
              maxLength={120}
              defaultValue={s?.name}
            />
          </Field>
          <Field label="Preço exibido">
            <input
              name="price_label"
              type="text"
              required
              maxLength={80}
              defaultValue={s?.price_label}
            />
          </Field>
          <Field label="Valor de referência (R$)">
            <input
              name="amount"
              type="number"
              step=".01"
              min="0"
              defaultValue={s?.amount ?? ""}
              placeholder="Vazio = sob consulta"
            />
          </Field>
        </div>
        <Field label="Descrição">
          <textarea
            name="description"
            maxLength={600}
            defaultValue={s?.description}
          />
        </Field>
        <div>
          <Submit busy={submit.busy} />
        </div>
      </form>
      <VersionTable
        rows={data.service_versions.filter((s: Row) => s.code === code)}
      />
    </>
  );
}
function FiscalSettings({ data, reload }: { data: Row; reload: () => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const row = data.fiscal.find((r: Row) => r.year === year),
    cfg = row?.config;
  const { notify } = useApp();
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    await api("/admin/configuracoes/fiscal", "PUT", {
      year,
      source: d.source,
      config: {
        meiLimit: Number(d.meiLimit),
        das: {
          comercio: Number(d.comercio),
          servicos: Number(d.servicos),
          ambos: Number(d.ambos),
        },
        simplesBands: Array.from({ length: 6 }, (_, i) =>
          Number(d["band" + i]),
        ),
        alert: Number(d.alert) / 100,
        notesIncluded: Number(d.notesIncluded),
        extraNote: Number(d.extraNote),
      },
    });
    notify("Parâmetros anuais salvos com registro de auditoria.");
    reload();
  });
  return (
    <form
      className="card"
      key={year + ":" + (row?.created_at || "new")}
      {...submit}
    >
      <h3>Parâmetros fiscais e operacionais por ano</h3>
      <p className="hint">
        Confira a legislação e a vigência antes de publicar. Anos sem
        configuração ficam como “A definir”. Os indicadores são gerenciais e não
        emitem ou apuram tributos.
      </p>
      <Field label="Ano">
        <input
          type="number"
          min="2000"
          max="2200"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        />
      </Field>
      {!row && (
        <p className="banner">
          Este ano ainda não está configurado. Nenhum valor de outro ano será
          aplicado automaticamente.
        </p>
      )}
      <div className="fields">
        <Field label="Limite anual do MEI (R$)">
          <input
            name="meiLimit"
            type="number"
            min=".01"
            step=".01"
            defaultValue={cfg?.meiLimit ?? ""}
            required
          />
        </Field>
        <Field label="DAS comércio (R$)">
          <input
            name="comercio"
            type="number"
            min="0"
            step=".01"
            defaultValue={cfg?.das.comercio ?? ""}
            required
          />
        </Field>
        <Field label="DAS serviços (R$)">
          <input
            name="servicos"
            type="number"
            min="0"
            step=".01"
            defaultValue={cfg?.das.servicos ?? ""}
            required
          />
        </Field>
        <Field label="DAS comércio e serviços (R$)">
          <input
            name="ambos"
            type="number"
            min="0"
            step=".01"
            defaultValue={cfg?.das.ambos ?? ""}
            required
          />
        </Field>
        <Field label="Alerta a partir de (%)">
          <input
            name="alert"
            type="number"
            min="10"
            max="100"
            step="1"
            defaultValue={cfg ? cfg.alert * 100 : 80}
            required
          />
        </Field>
        <Field label="Notas incluídas nos planos MEI Pro / Growth">
          <input
            name="notesIncluded"
            type="number"
            min="0"
            step="1"
            defaultValue={cfg?.notesIncluded ?? 5}
            required
          />
        </Field>
        <Field label="Nota adicional — referência (R$)">
          <input
            name="extraNote"
            type="number"
            min="0"
            step=".01"
            defaultValue={cfg?.extraNote ?? 35}
            required
          />
        </Field>
      </div>
      <h3>Faixas de receita em 12 meses</h3>
      <div className="fields">
        {Array.from({ length: 6 }, (_, i) => (
          <Field key={i} label={`${i + 1}ª faixa — limite (R$)`}>
            <input
              name={"band" + i}
              type="number"
              min=".01"
              step=".01"
              defaultValue={cfg?.simplesBands[i] ?? ""}
              required
            />
          </Field>
        ))}
      </div>
      <Field label="Fonte oficial / referência da configuração">
        <input
          type="url"
          name="source"
          defaultValue={row?.source || ""}
          required
          maxLength={1000}
        />
      </Field>
      <div>
        <Submit busy={submit.busy}>Publicar parâmetros do ano</Submit>
      </div>
    </form>
  );
}
function ContactSettings({ data, reload }: { data: Row; reload: () => void }) {
  const { notify } = useApp();
  const submit = useSubmit(async (form) => {
    await api("/admin/configuracoes/contato", "PUT", formObject(form));
    notify("Canais de contato atualizados.");
    reload();
  });
  return (
    <form className="card" {...submit}>
      <h3>Conversas que aproximam</h3>
      <Field label="WhatsApp — 55 + DDD + número (opcional)">
        <input
          name="whatsapp"
          type="tel"
          pattern="55[0-9]{10,11}"
          defaultValue={data.contact.whatsapp}
        />
      </Field>
      <Field label="Instagram">
        <input
          name="instagram"
          type="url"
          required
          defaultValue={data.contact.instagram}
        />
      </Field>
      <Field label="Agenda da Conversa de Clareza">
        <input
          name="agenda"
          type="url"
          required
          defaultValue={data.contact.agenda}
        />
      </Field>
      <div>
        <Submit busy={submit.busy} />
      </div>
    </form>
  );
}
const actions: Record<string, string> = {
  "login.sucesso": "Login realizado",
  "login.negado": "Tentativa de login negada",
  logout: "Saída da conta",
  "cliente.criado": "Cliente cadastrado",
  "cliente.alterado": "Cadastro alterado",
  "cliente.excluido": "Cliente excluído",
  "documento.download": "Documento baixado",
  "documento.enviado": "Documento enviado",
  "documento.excluido": "Documento excluído",
  "faturamento.enviado": "Faturamento informado",
  "faturamento.revisado": "Faturamento revisado",
  "honorario.alterado": "Recebimento alterado",
  "contrato.alterado": "Contrato alterado",
  "usuario.criado": "Acesso criado",
  "usuario.convite": "Convite solicitado",
  "competencia.alterada": "Checklist alterado",
};
export function Audit() {
  const [before, setBefore] = useState("");
  const list = useData(
    "/admin/auditoria?limit=100" + (before ? "&before=" + before : ""),
    [],
  );
  return (
    <>
      <p className="muted small">
        Histórico de acessos, leituras e alterações. Conteúdos privados e
        credenciais não são registrados aqui.
      </p>
      <State loading={list.loading} error={list.error}>
        <div className="card">
          <h3>Atividade recente</h3>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Responsável</th>
                  <th>Ação</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((r: Row) => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.created_at).toLocaleString("pt-BR", {
                        timeZone: "America/Sao_Paulo",
                      })}
                    </td>
                    <td>{r.actor_name || "Sistema / público"}</td>
                    <td>
                      {actions[r.action] || r.action.replaceAll(".", " · ")}
                      {r.metadata.month && (
                        <p className="muted">{monthLabel(r.metadata.month)}</p>
                      )}
                      {r.metadata.status && (
                        <p className="muted">{r.metadata.status}</p>
                      )}
                    </td>
                    <td className="muted">{r.ip || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            {before && (
              <button className="btn ghost sm" onClick={() => setBefore("")}>
                Mais recentes
              </button>
            )}
            {list.data.length === 100 && (
              <button
                className="btn ghost sm"
                onClick={() => setBefore(list.data.at(-1).id)}
              >
                Anteriores
              </button>
            )}
          </div>
        </div>
      </State>
    </>
  );
}
