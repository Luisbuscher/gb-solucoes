export const BUSINESS_NAME = "GB Soluções";
export const BUSINESS_CRC = "RS-107227/0";
export function Footer() {
  return (
    <footer className="app-footer">
      <span>Clareza para organizar. Confiança para crescer.</span>
      <br />
      <strong>
        {BUSINESS_NAME} · CRC {BUSINESS_CRC}
      </strong>
      <br />
      <a
        href="https://wa.me/5551991056678"
        target="_blank"
        rel="noopener noreferrer"
      >
        WhatsApp: (51) 99105-6678
      </a>
    </footer>
  );
}
