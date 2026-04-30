"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BODY_MAX = 4000;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.8rem",
  background: "var(--color-card)",
  border: "1px solid var(--color-card-border)",
  borderRadius: 8,
  color: "var(--color-text)",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "0.35rem",
  fontSize: "0.85rem",
  color: "var(--color-muted)",
};

const errStyle: React.CSSProperties = {
  color: "#f87171",
  fontSize: "0.8rem",
  marginTop: "0.3rem",
};

type FieldErrors = Record<string, string[] | undefined>;

export function FeedbackForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [bodyLength, setBodyLength] = useState(0);
  const [errs, setErrs] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setErrs({});
    setTopError(null);

    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const payload = {
      submitterName: String(fd.get("submitterName") ?? "").trim(),
      submitterEmail: String(fd.get("submitterEmail") ?? "").trim(),
      title: String(fd.get("title") ?? "").trim(),
      body: String(fd.get("body") ?? "").trim(),
      category: (fd.get("category") || null) as
        | "bug"
        | "feature"
        | "question"
        | "other"
        | null,
    };

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 201) {
        router.push("/?submitted=1");
        router.refresh();
        return;
      }

      // 400 with field errors
      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as {
          fieldErrors?: FieldErrors;
          error?: string;
        };
        if (data.fieldErrors) setErrs(data.fieldErrors);
        else setTopError(data.error ?? "Validation failed");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setTopError(data.error ?? `Submission failed (HTTP ${res.status}).`);
    } catch (err) {
      setTopError(
        err instanceof Error
          ? err.message
          : "Network error — please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "1rem" }}>
      {topError && (
        <div
          style={{
            padding: "0.65rem 0.85rem",
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.4)",
            borderRadius: 8,
            color: "#f87171",
            fontSize: "0.85rem",
          }}
        >
          {topError}
        </div>
      )}

      <div>
        <label htmlFor="submitterName" style={labelStyle}>
          Your name
        </label>
        <input
          id="submitterName"
          name="submitterName"
          type="text"
          required
          maxLength={100}
          style={inputStyle}
        />
        {errs.submitterName && <div style={errStyle}>{errs.submitterName[0]}</div>}
      </div>

      <div>
        <label htmlFor="submitterEmail" style={labelStyle}>
          Email
        </label>
        <input
          id="submitterEmail"
          name="submitterEmail"
          type="email"
          required
          maxLength={200}
          style={inputStyle}
        />
        {errs.submitterEmail && <div style={errStyle}>{errs.submitterEmail[0]}</div>}
      </div>

      <div>
        <label htmlFor="category" style={labelStyle}>
          Category
        </label>
        <select id="category" name="category" defaultValue="" style={inputStyle}>
          <option value="">—</option>
          <option value="bug">Bug</option>
          <option value="feature">Feature request</option>
          <option value="question">Question</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div>
        <label htmlFor="title" style={labelStyle}>
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          minLength={3}
          maxLength={140}
          style={inputStyle}
          placeholder="Short summary"
        />
        {errs.title && <div style={errStyle}>{errs.title[0]}</div>}
      </div>

      <div>
        <label htmlFor="body" style={labelStyle}>
          Details
        </label>
        <textarea
          id="body"
          name="body"
          required
          minLength={10}
          maxLength={BODY_MAX}
          rows={6}
          style={{ ...inputStyle, resize: "vertical", minHeight: 120 }}
          placeholder="What's the bug, what would you like, what are you trying to do…"
          onChange={(e) => setBodyLength(e.target.value.length)}
        />
        <div
          style={{
            fontSize: "0.78rem",
            textAlign: "right",
            marginTop: "0.25rem",
            color: bodyLength >= BODY_MAX * 0.9 ? "#f87171" : "var(--color-muted)",
          }}
        >
          {bodyLength} / {BODY_MAX}
        </div>
        {errs.body && <div style={errStyle}>{errs.body[0]}</div>}
      </div>

      <button
        type="submit"
        disabled={pending}
        style={{
          padding: "0.7rem 1rem",
          background: pending ? "var(--color-card-border)" : "var(--color-accent)",
          color: pending ? "var(--color-muted)" : "var(--color-bg)",
          fontWeight: 600,
          border: "none",
          borderRadius: 8,
          cursor: pending ? "not-allowed" : "pointer",
          fontSize: "0.95rem",
        }}
      >
        {pending ? "Submitting…" : "Submit feedback"}
      </button>
    </form>
  );
}
