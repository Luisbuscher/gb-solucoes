import argon2 from "argon2";
import { config } from "./config.js";
import { transaction, uid } from "./db.js";
export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};
const plans = [
  ["MEI Essencial", 130, null, null, null],
  ["MEI Pro", 190, null, null, null],
  ["MEI Growth", 290, null, null, null],
  ["Empresa Clareza", 350, 15000, 1, 2.75],
  ["Empresa Estrutura", 430, 30000, 2, 3.5],
  ["Empresa Expansão", 520, 60000, null, 4.5],
  ["BPO Financeiro", 0, null, null, null],
  ["Avulso", 0, null, null, null],
];
export const serviceSeeds = [
  [
    "mei-abertura",
    "MEI",
    "MEI Pronto para Começar",
    "Abertura, kit prático de boas-vindas e consultoria de 15 minutos",
    "R$ 160",
    160,
  ],
  [
    "mei-alteracao",
    "MEI",
    "Alteração cadastral do MEI",
    "Atividade, endereço ou dados do MEI",
    "R$ 50",
    50,
  ],
  [
    "dasn",
    "MEI",
    "Declaração anual (DASN-SIMEI)",
    "Preenchimento e entrega. Incluída no plano MEI Growth",
    "R$ 90",
    90,
  ],
  [
    "nota",
    "MEI",
    "Emissão de nota fiscal",
    "Nos planos: combo de 5 notas adicionais por R$ 130",
    "R$ 35 por nota",
    35,
  ],
  [
    "mei-baixa",
    "MEI",
    "Baixa do MEI",
    "Encerramento do cadastro e apurações finais",
    "R$ 160",
    160,
  ],
  [
    "mei-regularizacao",
    "MEI",
    "Regularização de Pendências Fiscais e Cadastrais (MEI)",
    "Diagnóstico e plano de regularização",
    "Sob consulta",
    null,
  ],
  [
    "empresa-abertura",
    "Empresas",
    "Abertura de empresa",
    "Para clientes de plano Empresa. Isolada: R$ 380. Com sócios ou licenças específicas: a partir de R$ 450",
    "A partir de R$ 280",
    280,
  ],
  [
    "empresa-alteracao",
    "Empresas",
    "Alteração empresarial",
    "Endereço, atividade, nome ou quadro de sócios",
    "R$ 200",
    200,
  ],
  [
    "empresa-baixa",
    "Empresas",
    "Baixa de empresa",
    "Encerramento completo",
    "R$ 350",
    350,
  ],
  [
    "empresa-regularizacao",
    "Empresas",
    "Regularização de Pendências Fiscais e Cadastrais (empresa)",
    "Diagnóstico e plano de regularização",
    "A partir de R$ 100",
    100,
  ],
  [
    "consultoria",
    "Consultoria e planejamento",
    "Consultoria pontual",
    "Até 40 minutos. Clientes de plano: R$ 80",
    "R$ 120",
    120,
  ],
  [
    "transicao",
    "Consultoria e planejamento",
    "Planejamento e transição MEI para Empresa",
    "Para quem cresce além do MEI. Clientes MEI Growth: R$ 350",
    "R$ 450",
    450,
  ],
  [
    "tributario",
    "Consultoria e planejamento",
    "Planejamento tributário",
    "Estudo individual do melhor enquadramento",
    "Sob consulta",
    null,
  ],
];
export async function seed() {
  await transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(842763)");
    const email = config.ADMIN_EMAIL.toLowerCase();
    const old = (await db.query("SELECT * FROM users WHERE primary_admin"))
      .rows[0];
    const changed =
      !old ||
      old.email !== email ||
      !(await argon2.verify(old.password_hash, config.ADMIN_PASSWORD));
    if (!old)
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,role,primary_admin) VALUES($1,$2,'Administradora principal',$3,'admin',true)",
        [
          uid(),
          email,
          await argon2.hash(config.ADMIN_PASSWORD, passwordOptions),
        ],
      );
    else if (changed) {
      await db.query(
        "UPDATE users SET email=$1,password_hash=$2,active=true WHERE id=$3",
        [
          email,
          await argon2.hash(config.ADMIN_PASSWORD, passwordOptions),
          old.id,
        ],
      );
      await db.query("DELETE FROM sessions WHERE user_id=$1", [old.id]);
    }
    for (const [code, amount, ceiling, partners, hours] of plans) {
      await db.query("INSERT INTO plans VALUES($1) ON CONFLICT DO NOTHING", [
        code,
      ]);
      await db.query(
        "INSERT INTO plan_versions VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(code,effective) DO NOTHING",
        [uid(), code, "2026-01", amount, ceiling, partners, hours],
      );
    }
    for (const [
      code,
      category,
      name,
      description,
      label,
      amount,
    ] of serviceSeeds)
      await db.query(
        "INSERT INTO service_versions VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(code,effective) DO NOTHING",
        [uid(), code, "2026-01", category, name, description, label, amount],
      );
    await db.query(
      "INSERT INTO fiscal_configs(year,config,source) VALUES(2026,$1,$2) ON CONFLICT DO NOTHING",
      [
        JSON.stringify({
          meiLimit: 81000,
          das: { comercio: 82.05, servicos: 86.05, ambos: 87.05 },
          simplesBands: [180000, 360000, 720000, 1800000, 3600000, 4800000],
          alert: 0.8,
          notesIncluded: 5,
          extraNote: 35,
        }),
        "https://www.gov.br/empresas-e-negocios/pt-br/empreendedor/itens-inativo/perguntas-frequentes",
      ],
    );
  });
}
