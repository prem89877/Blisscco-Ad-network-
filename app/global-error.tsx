"use client";

// Poore app ka aakhri bachav (root layout hi toot jaye tab). Apna <html>/<body> chahiye, isliye simple inline style.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0B1020", color: "#F8FAFC", fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "96px 24px" }}>
          <h1 style={{ fontSize: 28 }}>Something went wrong</h1>
          <p style={{ opacity: 0.75 }}>Please try again. If it keeps happening, come back in a few minutes.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 24, minHeight: 44, padding: "10px 20px", borderRadius: 8, border: 0, background: "#7657FF", color: "#fff", fontSize: 16 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
