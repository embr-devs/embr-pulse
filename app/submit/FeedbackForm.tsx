"use client";

import { useActionState, useState } from "react";
import { submitFeedbackAction, type SubmitFeedbackResult } from "./actions";

const BODY_MAX = 4000;

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.65rem 0.8rem",
  background: "#11141a",
  border: "1px solid #2a2f36",
  borderRadius: 8,
  color: "#e6e8eb",
  fontSize: "0.95rem",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: "0.35rem",
  fontSize: "0.85rem",
  color: "#b6bcc6",
};

const errStyle: React.CSSProperties = {
  color: "#f87171",
  fontSize: "0.8rem",
  marginTop: "0.3rem",
};

export function FeedbackForm() {
  const [state, formAction, pending] = useActionState<
    SubmitFeedbackResult | null,
    FormData
  >(submitFeedbackAction, null);
  const [bodyLength, setBodyLength] = useState(0);

  const errs =
    state && !state.ok
      ? state.fieldErrors
      : ({} as Record<string, string[] | undefined>);

  return (
    <form action={formAction} style={{ display: "grid", gap: "1rem" }}>
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
            color: bodyLength >= BODY_MAX * 0.9 ? "#f87171" : "#8a93a0",
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
          background: pending ? "#2a2f36" : "#7aa2ff",
          color: pending ? "#8a93a0" : "#0b0d10",
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
