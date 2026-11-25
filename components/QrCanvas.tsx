"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download } from "lucide-react";

interface QrCanvasProps {
  value: string;
  title?: string;
  subtitle?: string;
  size?: number;
  filename?: string;
}

export function QrCanvas({
  value,
  title,
  subtitle,
  size = 200,
  filename = "quizgate-qr.png",
}: QrCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !value) return;
    QRCode.toCanvas(cv, value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    }).catch(() => {});
  }, [value, size]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked
    }
  };

  const handleDownloadPng = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const url = cv.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="bg-white text-slate-900 border border-slate-200 rounded-2xl p-4 flex flex-col items-center text-center shadow-sm">
      {title && <h4 className="font-bold text-sm text-slate-900">{title}</h4>}
      {subtitle && <p className="text-xs text-slate-500 mt-0.5 mb-3">{subtitle}</p>}

      <div className="p-2 bg-white rounded-xl border border-slate-200 shadow-inner">
        <canvas
          ref={canvasRef}
          className="rounded-lg max-w-full h-auto"
          aria-label={title || "QR Verification Code"}
        />
      </div>

      <code className="mt-3 w-full text-[11px] font-mono bg-slate-50 border border-slate-200 text-slate-600 px-2.5 py-2 rounded-lg break-all select-all">
        {value}
      </code>

      <div className="flex flex-wrap gap-2 mt-3 w-full justify-center no-print">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 min-h-[40px]"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? "Copied" : "Copy Code"}</span>
        </button>
        <button
          type="button"
          onClick={handleDownloadPng}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 min-h-[40px]"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Save PNG</span>
        </button>
      </div>
    </div>
  );
}
