"use client";
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "weave";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", busy, className, children, disabled, ...rest },
  ref,
) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none";
  const sizes = { sm: "h-8 px-3 text-sm rounded-[var(--radius-sm)]", md: "h-10 px-4 text-[15px] rounded-[var(--radius-md)]", lg: "h-13 px-6 text-[17px] rounded-[var(--radius-md)]" };
  const variants = {
    primary: "bg-spruce text-white hover:bg-spruce-deep",
    secondary: "bg-surface text-ink border border-line-strong hover:border-ink",
    ghost: "text-ink hover:bg-ink/5",
    danger: "bg-surface text-alarm border border-alarm/40 hover:bg-alarm-wash",
    weave: "bg-weave text-white hover:bg-weave-deep",
  };
  return (
    <button ref={ref} className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cx("animate-spin", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        "h-11 w-full rounded-[var(--radius-md)] border border-line-strong bg-surface px-3 text-ink placeholder:text-faint focus:border-spruce focus:outline-none focus:ring-2 focus:ring-spruce/25",
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { autoGrow?: boolean }>(function Textarea(
  { className, autoGrow, onInput, ...rest },
  ref,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const grow = () => {
    const el = inner.current;
    if (!el || !autoGrow) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 360) + "px";
  };
  useEffect(grow, [rest.value, autoGrow]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      onInput={(e) => {
        grow();
        onInput?.(e);
      }}
      className={cx(
        "w-full rounded-[var(--radius-md)] border border-line-strong bg-surface px-3 py-2.5 text-ink placeholder:text-faint focus:border-spruce focus:outline-none focus:ring-2 focus:ring-spruce/25",
        className,
      )}
      {...rest}
    />
  );
});

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[15px] font-semibold">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && (
        <p className="text-sm font-medium text-alarm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function Pill({ tone = "neutral", children, className }: { tone?: "neutral" | "spruce" | "weave" | "tide" | "alarm"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-ink/6 text-muted",
    spruce: "bg-spruce-wash text-spruce-deep",
    weave: "bg-weave-wash text-weave-deep",
    tide: "bg-tide-wash text-[#7a5006]",
    alarm: "bg-alarm-wash text-alarm",
  };
  return <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export function Notice({ tone = "neutral", children, className }: { tone?: "neutral" | "tide" | "alarm" | "weave"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "border-line bg-surface text-ink",
    tide: "border-tide/30 bg-tide-wash text-[#5d3e05]",
    alarm: "border-alarm/30 bg-alarm-wash text-alarm",
    weave: "border-weave-line bg-weave-wash text-weave-deep",
  };
  return <div className={cx("rounded-[var(--radius-md)] border px-4 py-3 text-[15px]", tones[tone], className)}>{children}</div>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-1.5rem)] rounded-[var(--radius-lg)] bg-surface p-0 text-ink shadow-[0_20px_60px_-20px_rgb(21_32_30/0.45)]",
        wide ? "max-w-4xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close">
              <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-md text-[15px] text-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** The Lofn mark: two threads crossing into one. */
export function LofnMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M5 8c7 0 9 16 22 16" fill="none" stroke="var(--color-spruce)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M5 24c7 0 9-16 22-16" fill="none" stroke="var(--color-weave)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.6" fill="var(--color-ink)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-display font-bold tracking-tight", className)}>
      <LofnMark className="size-[1.35em]" />
      Lofn
    </span>
  );
}

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className={cx("size-4", className)} aria-hidden="true">
      {kind === "text" && <path {...p} d="M5 6h14M5 11h14M5 16h9" />}
      {kind === "audio" && (
        <>
          <rect {...p} x="9" y="3" width="6" height="11" rx="3" />
          <path {...p} d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </>
      )}
      {(kind === "image" || kind === "image_text") && (
        <>
          <rect {...p} x="3.5" y="5" width="17" height="14" rx="2" />
          <circle {...p} cx="9" cy="10" r="1.6" />
          <path {...p} d="M20.5 16l-5-5-8 8" />
        </>
      )}
      {kind === "video" && (
        <>
          <rect {...p} x="3" y="6" width="13" height="12" rx="2" />
          <path {...p} d="M16 10.5l5-3v9l-5-3" />
        </>
      )}
    </svg>
  );
}

export const KIND_LABEL: Record<string, string> = { text: "Text", audio: "Audio", image: "Image", image_text: "Image + text", video: "Video" };
export const KIND_COLOR: Record<string, string> = {
  text: "#1d5c4d",
  audio: "#7a5c99",
  image: "#b7790c",
  image_text: "#d39b3a",
  video: "#2b7a9a",
};
