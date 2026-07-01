"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error" | "info";
type Toast = {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  toast: (t: {
    title: string;
    description?: string;
    variant?: ToastVariant;
  }) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

let counter = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const remove = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue["toast"]>(
    ({ title, description, variant = "default" }) => {
      const id = ++counter;
      setToasts((prev) => [...prev, { id, title, description, variant }]);
      setTimeout(() => remove(id), 5000);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const Icon =
    toast.variant === "success"
      ? CheckCircle2
      : toast.variant === "error"
        ? AlertCircle
        : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border bg-card p-4 shadow-lg animate-in slide-in-from-bottom-2",
        toast.variant === "success" && "border-emerald-300",
        toast.variant === "error" && "border-red-300",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-5 shrink-0",
          toast.variant === "success" && "text-emerald-600",
          toast.variant === "error" && "text-red-600",
          toast.variant === "info" && "text-blue-600",
        )}
      />
      <div className="flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {toast.description}
          </p>
        ) : null}
      </div>
      <button
        onClick={onClose}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
