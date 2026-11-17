import { Decimal } from "decimal.js";
export const currentMonth = () =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
export const currentDate = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(
    new Date(),
  );
export const monthShift = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};
export function tasksFor(type: string, plan: string, month: string) {
  const m = Number(month.slice(5));
  let tasks: { key: string; name: string; deadline?: string }[] = [];
  if (plan === "Avulso") return tasks;
  if (type === "ME" && !["BPO Financeiro", "Avulso"].includes(plan))
    tasks = [
      { key: "dados", name: "Dados do mês", deadline: "dias 1 a 5" },
      { key: "folha", name: "Pró-labore", deadline: "dias 5 a 10" },
      { key: "das", name: "Fiscal e DAS", deadline: "dias 10 a 15" },
      { key: "conc", name: "Contábil", deadline: "dias 15 a 25" },
      { key: "ctrl", name: "Controle", deadline: "até o fim do mês" },
    ];
  else
    tasks = [
      { key: "das", name: "Guia DAS" },
      { key: "dados", name: "Dados do mês" },
      { key: "conc", name: "Conciliação" },
      { key: "rel", name: "Relatório" },
    ].filter(
      (t) =>
        !(t.key === "das" && plan === "BPO Financeiro") &&
        !(
          t.key === "conc" &&
          plan !== "MEI Growth" &&
          plan !== "BPO Financeiro"
        ),
    );
  if ([1, 4, 7, 10].includes(m)) {
    if (plan === "Empresa Estrutura")
      tasks.push({ key: "tri", name: "Balancete trimestral" });
    if (["Empresa Expansão", "MEI Growth"].includes(plan))
      tasks.push({ key: "reuniao", name: "Reunião trimestral" });
  }
  if (plan === "MEI Growth" && m === 1)
    tasks.push({ key: "analise", name: "Análise anual" });
  if (type === "ME" && !["BPO Financeiro", "Avulso"].includes(plan)) {
    if (m === 1)
      tasks.push({ key: "revisao", name: "Revisão do plano e reajuste" });
    if (m === 2) tasks.push({ key: "informe", name: "Informe de rendimentos" });
    if (m === 3) tasks.push({ key: "defis", name: "DEFIS e fechamento anual" });
  }
  return tasks;
}
export function indicators(
  client: any,
  month: string,
  revenues: any[],
  fiscal: any,
  plan: any,
) {
  const year = month.slice(0, 4),
    annual = revenues.filter(
      (r) => r.month.startsWith(year) && r.month <= month,
    ),
    sum = annual.reduce((s, r) => s.plus(r.amount), new Decimal(0));
  let limit: Decimal | null = null;
  if (fiscal) {
    limit = new Decimal(fiscal.meiLimit);
    if (client.opening_month?.startsWith(year))
      limit = limit
        .div(12)
        .mul(13 - Number(client.opening_month.slice(5)))
        .toDecimalPlaces(2);
  }
  const last = annual.length
    ? Math.max(...annual.map((r) => Number(r.month.slice(5))))
    : 0;
  const projection = annual.length
    ? sum.plus(sum.div(annual.length).mul(12 - last))
    : null;
  const prev = revenues.filter(
    (r) => r.month < month && r.month >= monthShift(month, -12),
  );
  const current = revenues.find((r) => r.month === month);
  const rbt = prev.length
    ? prev
        .reduce((s, r) => s.plus(r.amount), new Decimal(0))
        .div(prev.length)
        .mul(12)
    : current
      ? new Decimal(current.amount).mul(12)
      : null;
  const band =
    rbt && fiscal
      ? fiscal.simplesBands.findIndex((n: number) => rbt.lte(n))
      : null;
  const recent = revenues
    .filter((r) => r.month <= month)
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 3);
  const average = recent.length
    ? recent
        .reduce((s, r) => s.plus(r.amount), new Decimal(0))
        .div(recent.length)
    : null;
  const use = limit && limit.gt(0) ? sum.div(limit).toNumber() : null;
  return {
    annual: sum.toFixed(2),
    limit: limit?.toFixed(2) ?? null,
    use,
    projection: projection?.toFixed(2) ?? null,
    alert:
      client.type === "MEI"
        ? use !== null &&
          (use >= (fiscal?.alert ?? 0.8) ||
            (projection && limit && projection.gt(limit)))
        : !!(
            rbt &&
            fiscal &&
            (band === -1 ||
              (average && plan?.ceiling && average.gt(plan.ceiling)) ||
              (band !== null &&
                band >= 0 &&
                rbt.gte(new Decimal(fiscal.simplesBands[band]).mul(0.9))))
          ),
    rbt: rbt?.toFixed(2) ?? null,
    estimated: prev.length < 12,
    months: prev.length,
    band:
      band === null
        ? null
        : band === -1
          ? "Acima do limite"
          : `${band + 1}ª faixa`,
    average: average?.toFixed(2) ?? null,
    das: fiscal?.das?.[client.activity] ?? null,
  };
}
