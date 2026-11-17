import { useEffect, useState } from "react";
import {
  LockKeyhole,
  Unlock,
  Eye,
  EyeOff,
  Plus,
  Download,
  ShieldCheck,
  FileKey,
} from "lucide-react";
import { api, downloadFile, date } from "./api";
import {
  useData,
  useApp,
  useSubmit,
  Field,
  Submit,
  State,
  Badge,
  formObject,
  type Row,
} from "./ui";

export function VaultPanel({ clientId }: { clientId: string }) {
  const path = "/admin/clientes/" + clientId + "/cofre",
    data = useData(path, { entries: [], certificates: [], expires_at: null });
  const { run, notify } = useApp();
  const [expires, setExpires] = useState<string | null>(null),
    [edit, setEdit] = useState<Row | null>(null),
    [shown, setShown] = useState<Row | null>(null),
    [certificate, setCertificate] = useState(false);
  useEffect(() => {
    setExpires(data.data.expires_at);
  }, [data.data.expires_at]);
  useEffect(() => {
    if (!expires) return;
    const timer = setTimeout(
      () => {
        setExpires(null);
        setEdit(null);
        setShown(null);
        setCertificate(false);
      },
      Math.max(0, new Date(expires).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expires]);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), 30000);
    return () => clearTimeout(timer);
  }, [shown]);
  const unlocked = !!expires && new Date(expires).getTime() > Date.now();
  const unlock = useSubmit(async (form) => {
    const result = await api(path + "/desbloquear", "POST", formObject(form));
    form.reset();
    setExpires(result.expires_at);
    data.reload();
    notify("Cofre liberado por cinco minutos nesta ficha.");
  });
  const save = useSubmit(async (form) => {
    const body = formObject(form);
    await api(
      path + "/credenciais" + (edit?.id ? "/" + edit.id : ""),
      edit?.id ? "PUT" : "POST",
      body,
    );
    setEdit(null);
    data.reload();
    notify("Acesso salvo no cofre cifrado.");
  });
  const upload = useSubmit(async (form) => {
    await api(path + "/certificados", "POST", new FormData(form));
    form.reset();
    setCertificate(false);
    data.reload();
    notify("Certificado validado e armazenado no cofre.");
  });
  return (
    <>
      <div className="card vault-intro">
        <div className="toolbar">
          <h3>
            <LockKeyhole size={18} /> Cofre do cliente
          </h3>
          <Badge tone={unlocked ? "ok" : "wait"}>
            {unlocked ? "Desbloqueado por 5 minutos" : "Bloqueado"}
          </Badge>
        </div>
        <p className="hint">
          Senhas, códigos e certificados ficam cifrados e são exclusivos da
          administração. Consultas, alterações e downloads ficam registrados. Os
          dados revelados se ocultam após 30 segundos.
        </p>
        {!unlocked ? (
          <form className="stack" {...unlock}>
            <Field label="Confirme sua senha de administradora">
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </Field>
            <div>
              <Submit busy={unlock.busy}>
                <Unlock size={14} />
                Desbloquear cofre
              </Submit>
            </div>
          </form>
        ) : (
          <div className="row">
            <button
              className="btn ghost sm"
              onClick={() =>
                setEdit({ label: "Prefeitura", kind: "prefeitura" })
              }
            >
              <Plus size={14} />
              Acesso à prefeitura
            </button>
            <button
              className="btn ghost sm"
              onClick={() =>
                setEdit({ label: "Simples Nacional", kind: "simples" })
              }
            >
              <Plus size={14} />
              Código do Simples
            </button>
            <button
              className="btn ghost sm"
              onClick={() => setEdit({ label: "", kind: "outro" })}
            >
              <Plus size={14} />
              Outro acesso
            </button>
            <button
              className="table-action"
              onClick={() =>
                void run(async () => {
                  await api(path + "/bloquear", "POST");
                  setExpires(null);
                  setEdit(null);
                  setShown(null);
                  data.reload();
                })
              }
            >
              Bloquear agora
            </button>
          </div>
        )}
      </div>
      {unlocked && edit && (
        <form className="card" key={edit.id || edit.kind} {...save}>
          <div className="toolbar">
            <h3>{edit.id ? "Editar acesso" : "Novo acesso protegido"}</h3>
            <button
              className="table-action"
              type="button"
              onClick={() => setEdit(null)}
            >
              Cancelar
            </button>
          </div>
          <div className="fields">
            <Field label="Identificação do acesso">
              <input
                type="text"
                name="label"
                defaultValue={edit.label || ""}
                required
                maxLength={80}
              />
            </Field>
            <Field label="Tipo">
              <select name="kind" defaultValue={edit.kind || "outro"}>
                <option value="prefeitura">Prefeitura / NFS-e</option>
                <option value="simples">Simples Nacional</option>
                <option value="govbr">Gov.br / Receita</option>
                <option value="outro">Outro portal</option>
              </select>
            </Field>
          </div>
          <Field label="Endereço do portal (HTTPS)">
            <input
              type="url"
              name="url"
              defaultValue={edit.url || ""}
              placeholder="https://…"
            />
          </Field>
          <Field label="Usuário / login">
            <input
              type="text"
              name="login"
              defaultValue={edit.login || ""}
              maxLength={254}
              autoComplete="off"
            />
          </Field>
          <div className="fields">
            <Field label="Senha do portal">
              <input
                type="password"
                name="password"
                defaultValue={edit.password || ""}
                maxLength={512}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Código de acesso">
              <input
                type="password"
                name="access_code"
                defaultValue={edit.access_code || ""}
                maxLength={512}
                autoComplete="off"
              />
            </Field>
          </div>
          <Field label="Observações do acesso">
            <textarea
              name="notes"
              maxLength={1000}
              defaultValue={edit.notes || ""}
            />
          </Field>
          <div>
            <Submit busy={save.busy}>Salvar no cofre</Submit>
          </div>
        </form>
      )}
      <State
        loading={data.loading && !data.data.entries.length}
        error={data.error}
      >
        <div className="card">
          <h3>Acessos cadastrados</h3>
          {!data.data.entries.length ? (
            <p className="muted small">
              Cadastre os acessos necessários à rotina deste cliente.
            </p>
          ) : (
            <div className="list">
              {data.data.entries.map((entry: Row) => (
                <div key={entry.id}>
                  <span>
                    <strong>{entry.label}</strong>
                    <p className="muted small">
                      {entry.kind === "prefeitura"
                        ? "Prefeitura / NFS-e"
                        : entry.kind === "simples"
                          ? "Simples Nacional"
                          : entry.kind === "govbr"
                            ? "Gov.br / Receita"
                            : "Outro portal"}{" "}
                      · atualizado em {date(entry.updated_at)}
                    </p>
                  </span>
                  <div className="row">
                    <button
                      className="btn ghost sm"
                      disabled={!unlocked}
                      onClick={() =>
                        void run(async () =>
                          setShown({
                            id: entry.id,
                            ...(await api(
                              path + "/credenciais/" + entry.id + "/revelar",
                              "POST",
                            )),
                          }),
                        )
                      }
                    >
                      <Eye size={14} />
                      Consultar
                    </button>
                    <button
                      className="table-action"
                      disabled={!unlocked}
                      onClick={() =>
                        void run(async () =>
                          setEdit({
                            id: entry.id,
                            ...(await api(
                              path + "/credenciais/" + entry.id + "/revelar",
                              "POST",
                            )),
                          }),
                        )
                      }
                    >
                      Editar
                    </button>
                    <button
                      className="table-action"
                      disabled={!unlocked}
                      onClick={() => {
                        if (confirm("Excluir este acesso do cofre?"))
                          void run(async () => {
                            await api(
                              path + "/credenciais/" + entry.id,
                              "DELETE",
                            );
                            data.reload();
                            setShown(null);
                          });
                      }}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </State>
      {shown && unlocked && (
        <div className="card revealed-secret">
          <div className="toolbar">
            <h3>{shown.label || "Senha do certificado"}</h3>
            <button className="table-action" onClick={() => setShown(null)}>
              <EyeOff size={14} />
              Ocultar agora
            </button>
          </div>
          {shown.url && (
            <a
              href={shown.url}
              target="_blank"
              rel="noopener noreferrer"
              className="small"
            >
              Abrir portal
            </a>
          )}
          {shown.login && (
            <p className="prewrap">
              <b>Login:</b> {shown.login}
            </p>
          )}
          {shown.password && (
            <p className="prewrap">
              <b>Senha:</b> {shown.password}
            </p>
          )}
          {shown.access_code && (
            <p className="prewrap">
              <b>Código:</b> {shown.access_code}
            </p>
          )}
          {shown.notes && <p className="hint prewrap">{shown.notes}</p>}
          <p className="hint">
            Esta visualização será ocultada automaticamente em 30 segundos.
          </p>
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <h3>
            <FileKey size={18} /> Certificados digitais A1
          </h3>
          <button
            className="btn ghost sm"
            disabled={!unlocked}
            onClick={() => setCertificate(!certificate)}
          >
            <Plus size={14} />
            Anexar certificado
          </button>
        </div>
        <p className="hint">
          Arquivo PFX ou P12, até 5 MB. O certificado é cifrado antes do envio
          ao armazenamento privado. A senha do certificado também fica
          protegida.
        </p>
        {unlocked && certificate && (
          <form className="stack" {...upload}>
            <Field label="Identificação do certificado">
              <input
                type="text"
                name="label"
                required
                maxLength={80}
                placeholder="Certificado A1 da empresa"
              />
            </Field>
            <Field label="Arquivo do certificado">
              <input type="file" name="file" accept=".pfx,.p12" required />
            </Field>
            <Field label="Senha do certificado">
              <input
                type="password"
                name="password"
                maxLength={512}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Validade informada (opcional)">
              <input name="valid_until" type="date" />
            </Field>
            <div>
              <Submit busy={upload.busy}>Guardar certificado</Submit>
            </div>
          </form>
        )}
        <div className="list">
          {data.data.certificates.map((cert: Row) => (
            <div key={cert.id}>
              <span>
                <strong>{cert.label}</strong>
                <p className="muted small">
                  {cert.filename} ·{" "}
                  {cert.valid_until
                    ? "validade informada: " + date(cert.valid_until)
                    : "validade não informada"}
                </p>
              </span>
              <div className="row">
                <button
                  className="btn ghost sm"
                  disabled={!unlocked}
                  onClick={() =>
                    void run(() =>
                      downloadFile(
                        path + "/certificados/" + cert.id + "/download",
                        cert.filename,
                        "POST",
                      ),
                    )
                  }
                >
                  <Download size={14} />
                  Baixar
                </button>
                <button
                  className="table-action"
                  disabled={!unlocked}
                  onClick={() =>
                    void run(async () =>
                      setShown(
                        await api(
                          path + "/certificados/" + cert.id + "/senha",
                          "POST",
                        ),
                      ),
                    )
                  }
                >
                  Ver senha
                </button>
                <button
                  className="table-action"
                  disabled={!unlocked}
                  onClick={() => {
                    if (confirm("Excluir o certificado do armazenamento?"))
                      void run(async () => {
                        await api(path + "/certificados/" + cert.id, "DELETE");
                        data.reload();
                      });
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
          ))}
        </div>
        {!data.data.certificates.length && (
          <p className="muted small">Nenhum certificado anexado.</p>
        )}
      </div>
    </>
  );
}
