import { query, transaction, uid } from "./db.js";
import { encrypt, decrypt, token, hash } from "./crypto.js";
import { config } from "./config.js";

type Transport = (
  payload: { from: string; to: string; subject: string; text: string },
  id: string,
) => Promise<{
  id?: string;
  error?: { name?: string; message?: string; statusCode?: number };
}>;
let testTransport: Transport | undefined;
export function setTestMailTransport(transport?: Transport) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Adaptador permitido apenas em teste.");
  testTransport = transport;
}
export function mailConfiguration() {
  const domain = config.from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() || "";
  const reason = !config.resendKey
    ? "Preencha RESEND_API_KEY no ambiente do backend."
    : !domain
      ? "Informe um remetente válido em RESEND_FROM_EMAIL."
      : /^(seudominio\.com|example\.(com|test)|localhost)$/.test(domain)
        ? "O remetente ainda usa um domínio de exemplo. Informe um domínio verificado no Resend."
        : null;
  return {
    configured: !reason,
    reason,
    from: config.from,
    localUrl: ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(config.APP_URL).hostname,
    ),
    url: config.APP_URL,
  };
}
function deliveryError(error: {
  name?: string;
  message?: string;
  statusCode?: number;
}) {
  const message = error.message || "",
    code = error.name || "provider_error";
  if (/domain.*(not verified|not found)|verify.*domain/i.test(message))
    return "Remetente não autorizado: verifique o domínio do e-mail no Resend.";
  if (
    code === "restricted_api_key" ||
    code === "invalid_api_key" ||
    error.statusCode === 401
  )
    return "A chave do Resend não está autorizada para este envio. Confira a chave e o domínio permitido.";
  if (/testing|own email|resend.dev/i.test(message))
    return "O remetente de teste do Resend só envia para o e-mail autorizado. Configure seu domínio verificado.";
  if (error.statusCode === 429)
    return "Limite de envios do Resend atingido. Uma nova tentativa será feita automaticamente.";
  if (error.statusCode === 403)
    return "O Resend recusou o remetente ou destinatário. Confira o domínio e as permissões da chave.";
  if (code === "network_error")
    return "Não foi possível conectar ao Resend. O sistema tentará novamente.";
  return (
    "O Resend não aceitou o envio (" +
    code +
    (error.statusCode ? ", HTTP " + error.statusCode : "") +
    "). Confira o painel do provedor."
  );
}
const realTransport: Transport = async (payload, id) => {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.resendKey,
        "Content-Type": "application/json",
        "Idempotency-Key": id,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as any;
    if (!response.ok)
      return {
        error: {
          name: data.name,
          message: data.message,
          statusCode: response.status,
        },
      };
    return { id: data.id };
  } catch {
    return { error: { name: "network_error" } };
  }
};
export async function issueToken(
  user: { id: string; email: string },
  kind: "invite" | "reset",
  immediate = true,
) {
  const value = token(),
    id = uid(),
    url =
      config.APP_URL +
      "/" +
      (kind === "invite" ? "convite" : "redefinir-senha") +
      "#" +
      value;
  await transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
    await db.query(
      "UPDATE mail_outbox SET status='Substituído',payload='' WHERE status IN ('Pendente','Falhou') AND id IN (SELECT id FROM auth_tokens WHERE user_id=$1 AND kind=$2 AND used_at IS NULL)",
      [user.id, kind],
    );
    await db.query(
      "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL",
      [user.id, kind],
    );
    await db.query(
      "INSERT INTO auth_tokens(id,user_id,token_hash,kind,expires_at) VALUES($1,$2,$3,$4,now()+$5::interval)",
      [
        id,
        user.id,
        hash(value),
        kind,
        kind === "invite" ? "24 hours" : "30 minutes",
      ],
    );
    await db.query(
      "INSERT INTO mail_outbox(id,user_id,payload) VALUES($1,$2,$3)",
      [
        id,
        user.id,
        encrypt(
          JSON.stringify({
            to: user.email,
            subject:
              kind === "invite"
                ? "Seu acesso à GB Soluções"
                : "Redefinição de senha — GB Soluções",
            text:
              (kind === "invite"
                ? "Defina sua senha para acessar a GB Soluções"
                : "Redefina sua senha") +
              ":\n\n" +
              url +
              "\n\nEste link é pessoal, temporário e de uso único. Se não solicitou, ignore esta mensagem.",
          }),
        ),
      ],
    );
  });
  if (immediate) await deliverMail(id);
  const [mail] = await query(
    "SELECT status,last_error FROM mail_outbox WHERE id=$1",
    [id],
  );
  return {
    status: mail.status,
    configured: mailConfiguration().configured,
    error: mail.last_error,
  };
}
export async function deliverMail(id?: string) {
  const readiness = mailConfiguration();
  if (!readiness.configured && !testTransport) {
    await query(
      "UPDATE mail_outbox SET last_error=$1 WHERE status='Pendente' AND ($2::uuid IS NULL OR id=$2)",
      [readiness.reason, id || null],
    );
    return;
  }
  if (process.env.NODE_ENV === "test" && !testTransport) return;
  await transaction(async (db) => {
    const rows = (
      await db.query(
        "SELECT m.* FROM mail_outbox m JOIN auth_tokens t ON t.id=m.id JOIN users u ON u.id=m.user_id LEFT JOIN clients c ON c.id=u.client_id WHERE m.status='Pendente' AND m.next_attempt_at<=now() AND t.expires_at>now() AND t.used_at IS NULL AND u.active AND (u.role='admin' OR (c.active AND NOT c.deletion_pending)) AND ($1::uuid IS NULL OR m.id=$1) ORDER BY m.created_at LIMIT 5 FOR UPDATE OF m SKIP LOCKED",
        [id || null],
      )
    ).rows;
    for (const row of rows) {
      let result: Awaited<ReturnType<Transport>>;
      try {
        const payload = JSON.parse(decrypt(row.payload));
        result = await (testTransport || realTransport)(
          {
            ...payload,
            from: config.from,
            subject: payload.subject.replaceAll("GB Clareza", "GB Soluções"),
            text: payload.text.replaceAll("GB Clareza", "GB Soluções"),
          },
          row.id,
        );
      } catch {
        result = { error: { name: "network_error" } };
      }
      if (!result.error && result.id)
        await db.query(
          "UPDATE mail_outbox SET status='Enviado',payload='',last_error=NULL,provider_id=$2,sent_at=now(),attempts=attempts+1 WHERE id=$1",
          [row.id, result.id],
        );
      else
        await db.query(
          "UPDATE mail_outbox SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'Falhou' ELSE 'Pendente' END,last_error=$2,next_attempt_at=now()+interval '5 minutes' WHERE id=$1",
          [row.id, deliveryError(result.error || { name: "invalid_response" })],
        );
    }
  });
}
