// ===================================================================
// D' CopynPrint — kontak Customer Service (WhatsApp)
// Ganti nomor di bawah ini kapan saja — format internasional TANPA
// tanda "+" dan tanpa spasi/strip. Contoh Indonesia: 6281234567890
// ===================================================================
export const SUPPORT_WA_NUMBER = "6283853367309";
export const SUPPORT_WA_MESSAGE = "Halo, saya butuh bantuan soal D' CopynPrint.";

export function supportWaLink(customMessage) {
  const text = encodeURIComponent(customMessage || SUPPORT_WA_MESSAGE);
  return `https://wa.me/${SUPPORT_WA_NUMBER}?text=${text}`;
}

// ===================================================================
// Fase C — notif WA buat status pesanan print (bukan ke nomor CS di
// atas, tapi ke nomor WhatsApp customer sendiri, kalau dia sudah isi
// "No. WhatsApp" di profilnya). Dipakai operator print dari dashboard
// (js/printer.js) pas Terima / Tolak / Tandai selesai pesanan.
// number harus format internasional TANPA "+" (mis. 6281234567890) —
// sama kayak SUPPORT_WA_NUMBER di atas.
// ===================================================================
export function waLinkTo(number, message) {
  const digits = (number || "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
