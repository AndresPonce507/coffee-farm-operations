/* ====================================================================== */
/* es-PA-first field labels for the /pay-period/[id] dossier.              */
/* Spanish is the farm-office canonical language; the dossier chrome reads  */
/* in Spanish so the family runs payroll review in their own language.      */
/* ====================================================================== */

/** A pay line / period status → a friendly Spanish label. */
export function statusLabelEs(status: string): string {
  switch (status) {
    case "approved":
      return "aprobado";
    case "paid":
      return "pagado";
    case "calculated":
      return "calculado";
    case "open":
      return "abierto";
    default:
      return status;
  }
}

/** A disbursement method → a friendly Spanish label (keeps the brand names). */
export function methodLabelEs(method: string): string {
  switch (method.toLowerCase()) {
    case "yappy":
      return "Yappy";
    case "nequi":
      return "Nequi";
    case "ach":
      return "ACH";
    case "cash-signed":
      return "efectivo firmado";
    case "cash":
    case "efectivo":
      return "efectivo";
    default:
      return method;
  }
}

/** USD with cents, always — the dossier's self-contained money formatter. */
export function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
