let csrf = "";
export async function api(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const form = body instanceof FormData;
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(!form && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const data = await response
    .json()
    .catch(() => ({ message: "O servidor não respondeu como esperado." }));
  if (data.csrf) csrf = data.csrf;
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.message || "Não foi possível concluir.");
  }
  return data;
}
export async function downloadFile(
  path: string,
  filename: string,
  method = "GET",
) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "X-CSRF-Token": csrf },
  });
  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Não foi possível baixar o arquivo." }));
    throw new Error(error.message);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const money = (v: unknown) =>
  Number(v || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
export const date = (v: string) =>
  v
    ? new Date(
        v.includes("T") ? v : v.slice(0, 10) + "T12:00:00-03:00",
      ).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "—";
export const monthNow = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
export const monthLabel = (m: string) =>
  new Date(m + "-15T12:00:00-03:00").toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
