"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { getPlatformImageGuide } from "@/lib/platformImage";
import type { Platform } from "@/types";

interface ImageCropModalProps {
  file: File;
  platform: Platform | string;
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}

const OUTPUT_MAX = 1440;

export function ImageCropModal({
  file,
  platform,
  open,
  busy = false,
  onCancel,
  onConfirm,
}: ImageCropModalProps) {
  const guide = getPlatformImageGuide(platform);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(guide.aspect);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setAspect(guide.aspect);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file, open, guide.aspect]);

  const stageSize = 320;
  const frame = useMemo(() => {
    if (aspect >= 1) {
      const w = stageSize;
      const h = Math.max(80, Math.round(stageSize / aspect));
      return { w, h };
    }
    const h = stageSize;
    const w = Math.max(80, Math.round(stageSize * aspect));
    return { w, h };
  }, [aspect]);

  // Cover-fit scale so image always fills the crop frame at zoom=1
  const baseScale = useMemo(() => {
    if (!natural.w || !natural.h) return 1;
    return Math.max(frame.w / natural.w, frame.h / natural.h);
  }, [natural, frame]);

  const display = {
    w: natural.w * baseScale * zoom,
    h: natural.h * baseScale * zoom,
  };

  const clampOffset = useCallback(
    (x: number, y: number, z = zoom) => {
      const dw = natural.w * baseScale * z;
      const dh = natural.h * baseScale * z;
      const maxX = Math.max(0, (dw - frame.w) / 2);
      const maxY = Math.max(0, (dh - frame.h) / 2);
      return {
        x: Math.min(maxX, Math.max(-maxX, x)),
        y: Math.min(maxY, Math.max(-maxY, y)),
      };
    },
    [natural, baseScale, frame, zoom],
  );

  function onPointerDown(e: React.PointerEvent) {
    if (busy) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset(clampOffset(dragStart.current.ox + dx, dragStart.current.oy + dy));
  }

  function onPointerUp() {
    setDragging(false);
    dragStart.current = null;
  }

  function changeZoom(next: number) {
    const z = Math.min(3, Math.max(1, next));
    setZoom(z);
    setOffset((prev) => clampOffset(prev.x, prev.y, z));
  }

  async function handleConfirm() {
    if (!objectUrl || !natural.w) return;

    const img = await loadImage(objectUrl);
    const scale = baseScale * zoom;
    // Image is centered in the frame, then offset by `offset`
    const imgLeft = (frame.w - display.w) / 2 + offset.x;
    const imgTop = (frame.h - display.h) / 2 + offset.y;

    // Crop rectangle in image pixel space
    const sx = Math.max(0, -imgLeft / scale);
    const sy = Math.max(0, -imgTop / scale);
    const sw = Math.min(natural.w - sx, frame.w / scale);
    const sh = Math.min(natural.h - sy, frame.h / scale);

    let outW = Math.round(sw);
    let outH = Math.round(sh);
    if (outW > OUTPUT_MAX) {
      const r = OUTPUT_MAX / outW;
      outW = OUTPUT_MAX;
      outH = Math.max(1, Math.round(outH * r));
    }

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) return;
    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    onConfirm(new File([blob], `${base}-cropped.jpg`, { type: "image/jpeg" }));
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Crop image"
        className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-900">Adjust crop</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Recommended: {guide.guide} · drag to reposition
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pt-4 space-y-3">
          {guide.presets.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {guide.presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAspect(p.aspect);
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                    Math.abs(aspect - p.aspect) < 0.001
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-indigo-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}

          <div
            ref={stageRef}
            className="relative mx-auto bg-gray-900 rounded-xl overflow-hidden select-none touch-none"
            style={{ width: frame.w, height: frame.h, cursor: dragging ? "grabbing" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {objectUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={objectUrl}
                alt="Crop preview"
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
                className="absolute max-w-none pointer-events-none"
                style={{
                  width: display.w || undefined,
                  height: display.h || undefined,
                  left: "50%",
                  top: "50%",
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            )}
            <div className="absolute inset-0 ring-2 ring-white/80 pointer-events-none" />
          </div>

          <div className="flex items-center gap-2">
            <ZoomOut className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              disabled={busy}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
              aria-label="Zoom"
            />
            <ZoomIn className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="text-[10px] text-gray-400 w-8 text-right">{zoom.toFixed(1)}×</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 mt-2 border-t border-gray-100 bg-gray-50">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !natural.w}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
              </>
            ) : (
              "Use cropped image"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for cropping."));
    img.src = src;
  });
}
