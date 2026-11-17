import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  isValidElement,
} from "react";
import type { ReactNode, FormEvent, ReactElement } from "react";
import { X, AlertCircle, LoaderCircle } from "lucide-react";
import { api } from "./api";
export type Row = Record<string, any>;
export const AppContext = createContext<{
  user: Row | null;
  setUser: (u: Row | null) => void;
  notify: (s: string) => void;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}>({ user: null, setUser: () => {}, notify: () => {}, run: async () => {} });
export const useApp = () => useContext(AppContext);
export function useData<T = any>(path: string | null, initial: any) {
  const [data, setData] = useState<T>(initial),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api(path)
      .then((d) => {
        if (alive) {
          setData(d);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, revision]);
  return {
    data,
    error,
    loading,
    reload: () => setRevision((r) => r + 1),
    setData,
  };
}
export function State({
  loading,
  error,
  empty,
  children,
}: {
  loading?: boolean;
  error?: string;
  empty?: boolean;
  children: ReactNode;
}) {
  if (loading)
    return (
      <div className="card loading">
        <LoaderCircle className="spin" size={22} /> Carregando dados…
      </div>
    );
  if (error)
    return (
      <div className="banner error">
        <AlertCircle size={20} />
        {error}
      </div>
    );
  if (empty)
    return (
      <div className="card empty">
        <h3>Nenhum registro ainda</h3>
        <p className="muted">Os novos registros aparecerão aqui.</p>
      </div>
    );
  return <>{children}</>;
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, { id })
        : children}
    </div>
  );
}
export function Submit({
  children = "Salvar",
  busy = false,
}: {
  children?: ReactNode;
  busy?: boolean;
}) {
  return (
    <button className="btn" disabled={busy} type="submit">
      {busy ? "Salvando…" : children}
    </button>
  );
}
export function Badge({
  children,
  tone = "wait",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"pill " + tone}>{children}</span>;
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "button,input,select,textarea",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const items = [
          ...(ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select,textarea,a[href]",
          ) || []),
        ];
        if (!items.length) return;
        const a = items[0],
          b = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="veil"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="row between">
          <p className="eyebrow">{title}</p>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  alert = false,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  alert?: boolean;
}) {
  return (
    <div className={"card stat " + (alert ? "flag" : "")}>
      <p className="eyebrow">{label}</p>
      <p className="big num">{value}</p>
      {detail && <p className="small muted">{detail}</p>}
    </div>
  );
}
export function useSubmit(fn: (form: HTMLFormElement) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const { run } = useApp();
  return {
    busy,
    onSubmit: (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      setBusy(true);
      void run(() => fn(form)).finally(() => setBusy(false));
    },
  };
}
export const formObject = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form));
