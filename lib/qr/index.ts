import QRCode from "qrcode";

export async function generateQrSvg(content: string): Promise<string> {
  return QRCode.toString(content, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 160,
  });
}

export async function generateQrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 200,
  });
}
