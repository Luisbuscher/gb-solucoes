import { useEffect, useState } from "react";
import {
  Plus,
  GripVertical,
  ArrowUpRight,
  RefreshCw,
  LayoutDashboard,
} from "lucide-react";
import { api, money, date } from "./api";
import {
  useData,
  useApp,
  State,
  Stat,
  Modal,
  Field,
  Submit,
  useSubmit,
  formObject,
  Badge,
  type Row,
} from "./ui";
const columns = [
  { status: "Recebida", title: "Recebidas", tone: "received" },
  { status: "Em andamento", title: "Em andamento", tone: "working" },
  { status: "Concluída", title: "Concluídas", tone: "done" },
  { status: "Cobrada", title: "Cobradas", tone: "billed" },
];
export function KanbanOrders({ month }: { month: string }) {
  const list = useData("/admin/pedidos?month=" + month, []),
    clients = useData("/admin/clientes?month=" + month, []),
    catalogue = useData("/public/catalogo", { services: [] });
  const { run, notify } = useApp();
  const [dragged, setDragged] = useState<string | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [creating, setCreating] = useState(false),
    [moving, setMoving] = useState(false),
    [search, setSearch] = useState(""),
    [client, setClient] = useState("");
  useEffect(() => {
    const timer = setInterval(() => {
      if (!dragged && !selected && !creating && !moving) list.reload();
    }, 15000);
    return () => clearInterval(timer);
  }, [dragged, selected, creating, moving]);
  async function move(
    id: string,
    status: string,
    before_id: string | null = null,
  ) {
    const current = list.data.find((p: Row) => p.id === id);
    if (!current || id === before_id || moving) return;
    setMoving(true);
    try {
      await api("/admin/pedidos/" + id + "/mover", "POST", {
        status,
        before_id,
        expected_revision: current.board_revision,
      });
      notify("Solicitação movida para " + status.toLowerCase() + ".");
    } finally {
      setDragged(null);
      setMoving(false);
      list.reload();
    }
  }
  const visible = list.data.filter(
    (p: Row) =>
      (!client || p.client_id === client) &&
      [p.client_name, p.contact_name, p.service_name, p.details]
        .join(" ")
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  return (
    <>
      <div className="grid">
        <Stat
          label="Solicitações em aberto"
          value={list.data.filter((p: Row) => p.status !== "Cobrada").length}
        />
        <Stat
          label="Concluídas a cobrar"
          value={money(
            list.data
              .filter((p: Row) => p.status === "Concluída")
              .reduce(
                (n: number, p: Row) =>
                  n + Math.round(Number(p.amount || 0) * 100),
                0,
              ) / 100,
          )}
        />
        <Stat
          label="Pedidos na competência"
          value={list.data.filter((p: Row) => p.date.startsWith(month)).length}
        />
      </div>
      <div className="toolbar">
        <div>
          <h3>Quadro de solicitações</h3>
          <p className="hint">
            Arraste os cartões entre as etapas. No celular, use o seletor de
            situação de cada cartão.
          </p>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={list.reload}>
            <RefreshCw size={14} />
            Atualizar
          </button>
          <button className="btn sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            Nova solicitação
          </button>
        </div>
      </div>
      <div className="filters">
        <input
          type="search"
          placeholder="Buscar cliente ou serviço…"
          aria-label="Buscar no quadro"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Filtrar quadro por cliente"
          value={client}
          onChange={(e) => setClient(e.target.value)}
        >
          <option value="">Todos os clientes e interessados</option>
          {clients.data.map((c: Row) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {list.error && <p className="banner error">{list.error}</p>}
      <State loading={list.loading && !list.data.length}>
        <div
          className={"kanban-board " + (moving ? "kanban-busy" : "")}
          aria-label="Quadro Kanban de solicitações"
        >
          {columns.map((col) => {
            const cards = visible
              .filter((p: Row) => p.status === col.status)
              .sort(
                (a: Row, b: Row) =>
                  a.board_position - b.board_position ||
                  b.created_at.localeCompare(a.created_at),
              );
            return (
              <section
                className={
                  "kanban-column " + col.tone + (dragged ? " drop-ready" : "")
                }
                key={col.status}
                aria-label={col.title}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = dragged || e.dataTransfer.getData("text/plain");
                  void run(() => move(id, col.status));
                }}
              >
                <header className="kanban-column-head">
                  <h3>
                    <i />
                    {col.title}
                  </h3>
                  <span>{cards.length}</span>
                </header>
                <div className="kanban-cards">
                  {cards.map((p: Row) => (
                    <article
                      className={
                        "kanban-card " + (dragged === p.id ? "dragging" : "")
                      }
                      key={p.id}
                      draggable={!moving}
                      onDragStart={(e) => {
                        setDragged(p.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", p.id);
                      }}
                      onDragEnd={() => setDragged(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const id =
                          dragged || e.dataTransfer.getData("text/plain");
                        void run(() => move(id, col.status, p.id));
                      }}
                    >
                      <div className="toolbar">
                        <Badge tone={p.source === "cliente" ? "ok" : "na"}>
                          {p.source === "cliente"
                            ? "Portal do cliente"
                            : p.source === "publico"
                              ? "Interessado"
                              : "Gestão"}
                        </Badge>
                        <GripVertical
                          size={16}
                          className="muted"
                          aria-label="Arrastar cartão"
                        />
                      </div>
                      <button
                        className="kanban-card-title"
                        onClick={() => setSelected(p)}
                      >
                        {p.service_name}
                      </button>
                      <p className="kanban-client">
                        {p.client_name || p.contact_name}
                      </p>
                      {p.details && (
                        <p className="kanban-description">{p.details}</p>
                      )}
                      <div className="kanban-card-meta">
                        <strong>
                          {p.amount === null
                            ? "Valor a confirmar"
                            : money(p.amount)}
                        </strong>
                        <span>{date(p.date)}</span>
                      </div>
                      <select
                        aria-label={
                          "Mover solicitação de " +
                          (p.client_name || p.contact_name) +
                          " — " +
                          p.service_name
                        }
                        value={p.status}
                        disabled={moving}
                        onChange={(e) =>
                          void run(() => move(p.id, e.target.value))
                        }
                      >
                        {columns.map((c) => (
                          <option key={c.status}>{c.status}</option>
                        ))}
                      </select>
                      <button
                        className="table-action"
                        onClick={() => setSelected(p)}
                      >
                        Abrir detalhes <ArrowUpRight size={12} />
                      </button>
                    </article>
                  ))}
                  {!cards.length && (
                    <div className="kanban-empty">
                      {dragged
                        ? "Solte o cartão nesta etapa"
                        : "Nenhuma solicitação nesta etapa"}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <p className="hint">
          O quadro inclui todas as solicitações em aberto e as cobradas na
          competência selecionada.
        </p>
      </State>
      {creating && (
        <CreateOrder
          clients={clients.data}
          services={catalogue.data.services}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
      {selected && (
        <OrderDetail
          order={selected}
          clients={clients.data}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            list.reload();
          }}
        />
      )}
    </>
  );
}
function CreateOrder({
  clients,
  services,
  onClose,
  onSaved,
}: {
  clients: Row[];
  services: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState(""),
    [amount, setAmount] = useState("");
  const { notify } = useApp();
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    await api("/admin/pedidos", "POST", { ...d, amount: d.amount || null });
    notify("Solicitação adicionada ao quadro.");
    onSaved();
  });
  return (
    <Modal title="Nova solicitação" onClose={onClose}>
      <form className="stack" {...submit}>
        <Field label="Cliente">
          <select name="client_id" required>
            <option value="">Selecione</option>
            {clients
              .filter((c) => c.active)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Serviço">
          <select
            name="service_code"
            required
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setAmount(
                services.find((s) => s.code === e.target.value)?.amount ?? "",
              );
            }}
          >
            <option value="">Selecione</option>
            {services.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Valor combinado (R$)">
          <input
            name="amount"
            type="number"
            min="0"
            step=".01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="A confirmar"
          />
        </Field>
        <Field label="Detalhes">
          <textarea name="details" maxLength={500} />
        </Field>
        <Submit busy={submit.busy}>Adicionar ao quadro</Submit>
      </form>
    </Modal>
  );
}
function OrderDetail({
  order: p,
  clients,
  onClose,
  onSaved,
}: {
  order: Row;
  clients: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { run, notify } = useApp();
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    await api("/admin/pedidos/" + p.id, "PATCH", {
      status: d.status,
      amount: d.amount || null,
      ...(d.client_id ? { client_id: d.client_id } : {}),
    });
    notify("Solicitação atualizada.");
    onSaved();
  });
  return (
    <Modal title="Detalhes da solicitação" onClose={onClose}>
      <div>
        <h2>{p.service_name}</h2>
        <p className="muted">
          {p.client_name || p.contact_name} · {date(p.date)}
        </p>
      </div>
      {p.contact_email && <p className="small">Contato: {p.contact_email}</p>}
      {p.details && <div className="card prewrap">{p.details}</div>}
      <form className="stack" {...submit}>
        {!p.client_id && (
          <Field label="Vincular a um cliente">
            <select name="client_id">
              <option value="">Manter como interessado</option>
              {clients
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Situação">
          <select name="status" defaultValue={p.status}>
            {columns.map((c) => (
              <option key={c.status}>{c.status}</option>
            ))}
          </select>
        </Field>
        <Field label="Valor combinado (R$)">
          <input
            type="number"
            name="amount"
            min="0"
            step=".01"
            defaultValue={p.amount ?? ""}
          />
        </Field>
        <p className="hint">
          Referência no momento do pedido: {p.price_label}. O valor combinado é
          confirmado pela gestão.
        </p>
        <div>
          <Submit busy={submit.busy} />
        </div>
      </form>
      <button
        className="btn danger sm"
        onClick={() => {
          if (confirm("Excluir esta solicitação definitivamente?"))
            void run(async () => {
              await api("/admin/pedidos/" + p.id, "DELETE");
              notify("Solicitação excluída.");
              onSaved();
            });
        }}
      >
        Excluir solicitação
      </button>
    </Modal>
  );
}
