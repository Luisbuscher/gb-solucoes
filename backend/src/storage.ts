import { Storage } from "@google-cloud/storage";
import fs from "node:fs";
import { config } from "./config.js";
import { fail } from "./security.js";
type Store = {
  put: (key: string, buffer: Buffer, mime: string) => Promise<void>;
  get: (key: string) => NodeJS.ReadableStream;
  remove: (key: string) => Promise<void>;
};
let testStore: Store | undefined;
export function setTestStore(store: Store) {
  if (process.env.NODE_ENV !== "test")
    throw new Error("Adaptador permitido apenas nos testes.");
  testStore = store;
}
let storage: Storage | undefined;
export function objectStore(): Store {
  if (testStore) return testStore;
  if (
    !config.gcsBucket ||
    (!process.env.GCS_SERVICE_ACCOUNT_JSON &&
      !process.env.GCS_SERVICE_ACCOUNT_FILE)
  )
    fail(
      503,
      "Google Cloud Storage pendente de configuração. Nenhum arquivo foi armazenado.",
    );
  if (!storage) {
    const credentials = JSON.parse(
      process.env.GCS_SERVICE_ACCOUNT_JSON ||
        fs.readFileSync(process.env.GCS_SERVICE_ACCOUNT_FILE!, "utf8"),
    );
    storage = new Storage({ credentials, projectId: credentials.project_id });
  }
  const bucket = storage.bucket(config.gcsBucket);
  return {
    async put(key, buffer, mime) {
      let metadata;
      try {
        [metadata] = await bucket.getMetadata();
      } catch (error: any) {
        if (error.code === 403)
          fail(
            503,
            "A conta de serviço precisa da permissão storage.buckets.get no bucket configurado. Nenhum arquivo foi publicado.",
          );
        throw error;
      }
      if (metadata.iamConfiguration?.publicAccessPrevention !== "enforced")
        fail(503, "O bucket deve ter prevenção de acesso público ativada.");
      try {
        await bucket.file(key).save(buffer, {
          resumable: false,
          validation: "crc32c",
          metadata: { contentType: mime, cacheControl: "private,no-store" },
        });
      } catch (error: any) {
        if (error.code === 403)
          fail(
            503,
            "A conta de serviço não tem permissão para criar objetos no bucket configurado.",
          );
        throw error;
      }
    },
    get: (key) => bucket.file(key).createReadStream(),
    async remove(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}
