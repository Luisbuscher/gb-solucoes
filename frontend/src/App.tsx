import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ChartNoAxesCombined,
  ListChecks,
  Plus,
  Wallet,
  FolderOpen,
  Settings,
  ShieldCheck,
  History,
  LogOut,
  Upload,
  Menu,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  FileText,
} from "lucide-react";
import { api, monthNow, monthLabel } from "./api";
import {
  AppContext,
  useApp,
  useData,
  Field,
  Submit,
  useSubmit,
  formObject,
  State,
  type Row,
} from "./ui";
import { PublicRequest, Documents, Orders, Revenue } from "./workflows";
import { Dashboard, Clients, Checklist, Fees } from "./management";
import { UsersPage, Configuration, Audit } from "./settings";
import { Footer } from "./branding";
import { PortalReports } from "./reports";
export function App() {
  const [user, setUser] = useState<Row | null>(null),
    [ready, setReady] = useState(false),
    [toast, setToast] = useState(""),
    [error, setError] = useState("");
  const notify = (s: string) => setToast(s);
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify((e as Error).message);
    }
  };
  useEffect(() => {
    api("/auth/session")
      .then((d) => setUser(d.user))
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
    const expired = () => {
      setUser(null);
      void api("/auth/session").catch(() => {});
      notify("Sua sessão expirou. Entre novamente.");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!ready)
    return (
      <div className="login">
        <p>Preparando GB Soluções…</p>
      </div>
    );
  if (error)
    return (
      <div className="login">
        <div className="card">
          <h2>Conexão indisponível</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => location.reload()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  return (
    <AppContext.Provider value={{ user, setUser, notify, run }}>
      <Routes>
        <Route path="/" element={<Navigate to="/solicitar" replace />} />
        <Route path="/solicitar" element={<PublicRequest />} />
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar-senha" element={<PasswordPage />} />
        <Route path="/redefinir-senha" element={<PasswordPage tokenMode />} />
        <Route
          path="/convite"
          element={<PasswordPage tokenMode invitation />}
        />
        <Route
          path="/admin/*"
          element={
            user?.role === "admin" ? (
              <Shell admin />
            ) : (
              <Navigate to={user ? "/portal" : "/login"} replace />
            )
          }
        />
        <Route
          path="/portal/*"
          element={
            user?.role === "cliente" ? (
              <Shell />
            ) : (
              <Navigate to={user ? "/admin" : "/login"} replace />
            )
          }
        />
        <Route
          path="*"
          element={
            <div className="login">
              <div className="card">
                <h2>Página não encontrada</h2>
                <Link to="/">Voltar ao início</Link>
              </div>
            </div>
          }
        />
      </Routes>
      {toast && (
        <div className="toast" role="status" onClick={() => setToast("")}>
          {toast}
        </div>
      )}
    </AppContext.Provider>
  );
}
function Brand() {
  return (
    <>
      <img src="/logo.jpg" alt="GB Soluções | Gestão Empresarial" />
      <p className="eyebrow">Gestão empresarial com clareza</p>
    </>
  );
}
function Login() {
  const { user, setUser } = useApp();
  const nav = useNavigate();
  const submit = useSubmit(async (form) => {
    const result = await api("/auth/login", "POST", formObject(form));
    setUser(result.user);
    nav(result.user.role === "admin" ? "/admin" : "/portal", { replace: true });
  });
  if (user)
    return (
      <Navigate to={user.role === "admin" ? "/admin" : "/portal"} replace />
    );
  return (
    <div className="login">
      <div className="login-box">
        <Brand />
        <h1>Bem-vindo à GB Soluções</h1>
        <hr className="rule" />
        <p className="muted">
          Seu negócio organizado.
          <br />
          Seu próximo passo, mais claro.
        </p>
        <form className="login-actions" {...submit}>
          <Field label="E-mail">
            <input name="email" type="email" required autoComplete="username" />
          </Field>
          <Field label="Senha">
            <input
              name="password"
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
            />
          </Field>
          <Submit busy={submit.busy}>Entrar na minha conta</Submit>
        </form>
        <Link className="small" to="/recuperar-senha">
          Esqueci minha senha
        </Link>
        <p className="note">
          O acesso é criado pela equipe GB Soluções.
          <br />
          <Link to="/solicitar">
            Conheça nossos serviços <ArrowUpRight size={13} />
          </Link>
        </p>
        <Footer />
      </div>
    </div>
  );
}
function PasswordPage({
  tokenMode = false,
  invitation = false,
}: {
  tokenMode?: boolean;
  invitation?: boolean;
}) {
  const [token] = useState(() => window.location.hash.slice(1)),
    [done, setDone] = useState(false);
  useEffect(() => {
    if (tokenMode && window.location.hash)
      history.replaceState(null, "", window.location.pathname);
  }, []);
  const submit = useSubmit(async (form) => {
    const d = formObject(form);
    if (tokenMode) {
      if (d.password !== d.confirm) throw new Error("As senhas não coincidem.");
      await api("/auth/definir-senha", "POST", { token, password: d.password });
    } else await api("/auth/recuperar", "POST", d);
    setDone(true);
  });
  return (
    <div className="login">
      <div className="login-box">
        <Brand />
        <h1>
          {invitation
            ? "Seu acesso à GB Soluções"
            : tokenMode
              ? "Defina sua senha"
              : "Recuperar acesso"}
        </h1>
        {done ? (
          <div className="card">
            <p>
              {tokenMode
                ? "Senha definida. Você já pode entrar."
                : "Se houver um acesso elegível, enviaremos as instruções para seu e-mail."}
            </p>
          </div>
        ) : (
          <form className="login-actions" {...submit}>
            {tokenMode ? (
              <>
                <Field label="Nova senha (mínimo 12 caracteres)">
                  <input
                    name="password"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                <Field label="Confirme a senha">
                  <input
                    name="confirm"
                    type="password"
                    minLength={12}
                    maxLength={128}
                    required
                    autoComplete="new-password"
                  />
                </Field>
                {!token && (
                  <p className="banner">
                    Abra o link completo enviado no convite ou e-mail de
                    recuperação.
                  </p>
                )}
              </>
            ) : (
              <Field label="E-mail cadastrado">
                <input type="email" name="email" required />
              </Field>
            )}
            <Submit busy={submit.busy}>
              {tokenMode ? "Definir senha" : "Enviar instruções"}
            </Submit>
          </form>
        )}
        <Link to="/login">Voltar para o login</Link>
      </div>
    </div>
  );
}
const adminMenu = [
  ["", "Visão da operação", LayoutDashboard],
  ["clientes", "Clientes", Users],
  ["faturamento", "Faturamento", ChartNoAxesCombined],
  ["checklist", "Checklist mensal", ListChecks],
  ["solicitacoes", "Solicitações", Plus],
  ["honorarios", "Honorários", Wallet],
  ["documentos", "Documentos", FolderOpen],
  ["usuarios", "Usuários", ShieldCheck],
  ["configuracoes", "Configurações", Settings],
  ["auditoria", "Auditoria", History],
] as const;
const clientMenu = [
  ["", "Visão geral", LayoutDashboard],
  ["documentos", "Documentos", FolderOpen],
  ["extratos", "Enviar extrato", Upload],
  ["faturamento", "Faturamento", ChartNoAxesCombined],
  ["solicitacoes", "Solicitar serviço", Plus],
  ["relatorios", "Relatórios", FileText],
] as const;
function Shell({ admin = false }: { admin?: boolean }) {
  const { user, setUser, run } = useApp();
  const [month, setMonth] = useState(monthNow());
  const location = useLocation();
  const base = admin ? "/admin" : "/portal";
  const menus = admin ? adminMenu : clientMenu;
  const path = location.pathname.slice(base.length).replace(/^\//, "");
  const title = menus.find((m) => m[0] === path)?.[1] || "GB Soluções";
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7));
  };
  return (
    <div className="shell">
      <aside className="side">
        <Link to={base} className="brand">
          <img src="/logo.jpg" alt="GB Soluções" />
          <div>
            <b>GB Soluções</b>
            <span>Gestão empresarial</span>
          </div>
        </Link>
        <p className="side-area">
          {admin ? "Painel de Gestão" : "Portal do Cliente"}
        </p>
        <nav className="nav" aria-label="Navegação principal">
          {menus.map(([slug, label, Icon]) => (
            <NavLink
              end={!slug}
              to={base + (slug ? "/" + slug : "")}
              key={slug}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
          <button
            className="exit"
            onClick={() =>
              void run(async () => {
                await api("/auth/logout", "POST");
                setUser(null);
              })
            }
          >
            <LogOut size={18} />
            Sair
          </button>
        </nav>
        <div className="side-user">
          <span className="avatar">{user?.name?.slice(0, 1)}</span>
          <div>
            <strong>{user?.name}</strong>
            <span>
              {user?.role === "admin" ? "Administração" : "Acesso do cliente"}
            </span>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="wrap">
          <div className="topline">
            <span className="eyebrow">
              GB Soluções{" "}
              <span className="crumb">
                / {admin ? "Gestão" : "Meu negócio"}
              </span>
            </span>
            <Link to="/solicitar" className="small">
              Catálogo de serviços <ArrowUpRight size={13} />
            </Link>
          </div>
          <header className="head">
            <div>
              <p className="eyebrow section-eyebrow">
                {admin ? "Clareza para organizar" : "Clareza para acompanhar"}
              </p>
              <h2>{title}</h2>
              <p className="muted small">
                {admin
                  ? "Acompanhe sua carteira e cuide de cada próximo passo."
                  : "Seu negócio, seus documentos e seus próximos passos."}
              </p>
            </div>
            <div className="stepper">
              <button aria-label="Mês anterior" onClick={() => shift(-1)}>
                <ChevronLeft size={16} />
              </button>
              <input
                type="month"
                aria-label="Competência"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
              />
              <button aria-label="Mês seguinte" onClick={() => shift(1)}>
                <ChevronRight size={16} />
              </button>
            </div>
          </header>
          {admin ? (
            <Routes>
              <Route index element={<Dashboard month={month} />} />
              <Route path="clientes" element={<Clients month={month} />} />
              <Route
                path="faturamento"
                element={<Revenue month={month} admin />}
              />
              <Route path="checklist" element={<Checklist month={month} />} />
              <Route
                path="solicitacoes"
                element={<Orders month={month} admin />}
              />
              <Route path="honorarios" element={<Fees month={month} />} />
              <Route
                path="documentos"
                element={<Documents month={month} admin />}
              />
              <Route path="usuarios" element={<UsersPage />} />
              <Route
                path="configuracoes"
                element={<Configuration month={month} />}
              />
              <Route path="auditoria" element={<Audit />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route index element={<PortalHome month={month} />} />
              <Route path="documentos" element={<Documents month={month} />} />
              <Route
                path="extratos"
                element={<Documents month={month} upload />}
              />
              <Route path="faturamento" element={<Revenue month={month} />} />
              <Route path="solicitacoes" element={<Orders month={month} />} />
              <Route
                path="relatorios"
                element={<PortalReports month={month} />}
              />
              <Route path="*" element={<Navigate to="/portal" replace />} />
            </Routes>
          )}
          <Footer />
        </div>
      </main>
    </div>
  );
}
function PortalHome({ month }: { month: string }) {
  const c = useData("/me?month=" + month, null);
  return (
    <State loading={c.loading} error={c.error}>
      {c.data && <Dashboard month={month} client={c.data} />}
    </State>
  );
}
