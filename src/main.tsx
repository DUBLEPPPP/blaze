import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const avatarUrl = "https://i.pinimg.com/736x/0d/ad/95/0dad951463f4f4f97294a7a976946b64.jpg";
const purchaseUrl = "https://www.pedri.lol/";

type Tab = "profile" | "settings" | "purchase";

type ApiState = {
  loading: boolean;
  message: string;
  ok: boolean | null;
};

function App() {
  const [tab, setTab] = useState<Tab>("profile");
  const [license, setLicense] = useState("");
  const [resetUser, setResetUser] = useState("");
  const [licenseInfo, setLicenseInfo] = useState<any>(null);
  const [redeemState, setRedeemState] = useState<ApiState>({ loading: false, message: "", ok: null });
  const [resetState, setResetState] = useState<ApiState>({ loading: false, message: "", ok: null });

  const licenseStatus = useMemo(() => {
    if (!licenseInfo) return "NO LICENSE";
    return String(licenseInfo.status || "ACTIVE").toUpperCase();
  }, [licenseInfo]);

  async function redeemLicense() {
    setRedeemState({ loading: true, message: "Checking license...", ok: null });
    setLicenseInfo(null);

    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license })
      });
      const data = await response.json();
      setRedeemState({ loading: false, message: data.message || "Done", ok: Boolean(data.success) });
      if (data.success) setLicenseInfo(data.license);
    } catch {
      setRedeemState({ loading: false, message: "Could not contact the API.", ok: false });
    }
  }

  async function resetHwid() {
    setResetState({ loading: true, message: "Resetting HWID...", ok: null });

    try {
      const response = await fetch("/api/reset-hwid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: resetUser })
      });
      const data = await response.json();
      setResetState({ loading: false, message: data.message || "Done", ok: Boolean(data.success) });
    } catch {
      setResetState({ loading: false, message: "Could not contact the API.", ok: false });
    }
  }

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <nav className="top-nav" aria-label="Main navigation">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
        <button className={tab === "purchase" ? "active" : ""} onClick={() => setTab("purchase")}>Purchase</button>
      </nav>

      <section className="hero-card">
        <div className="hero-media" />
        <div className="hero-overlay" />
        <img className="avatar" src={avatarUrl} alt="Profile avatar" />
        <div className="hero-copy">
          {licenseStatus === "EXPIRED" && <span className="expired-dot">Expired</span>}
          <h1>/pedri.exe's</h1>
        </div>
      </section>

      {tab === "profile" && (
        <section className="grid profile-grid">
          <InfoCard label="User ID" value="17845266" />
          <InfoCard label="Rank" value="USER" />
          <InfoCard label="License" value={licenseStatus} danger={licenseStatus !== "ACTIVE"} />
        </section>
      )}

      {tab === "settings" && (
        <section className="grid settings-grid">
          <div className="panel">
            <h2>Redeem License</h2>
            <p className="muted">Check your KeyAuth license status before linking it to your profile.</p>
            <input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="blaze-xxxx-xxxx-xxxx" />
            <button onClick={redeemLicense} disabled={redeemState.loading}>{redeemState.loading ? "Checking..." : "Redeem License"}</button>
            <Status state={redeemState} />
          </div>

          <div className="panel">
            <h2>HWID Reset</h2>
            <p className="muted">Enter the KeyAuth username connected to your license. Reset is handled by Seller API.</p>
            <input value={resetUser} onChange={(event) => setResetUser(event.target.value)} placeholder="KeyAuth username" />
            <button onClick={resetHwid} disabled={resetState.loading}>{resetState.loading ? "Resetting..." : "Reset HWID"}</button>
            <Status state={resetState} />
          </div>
        </section>
      )}

      {tab === "purchase" && (
        <section className="purchase-panel">
          <div>
            <span className="eyebrow">Blaza PVP</span>
            <h2>Get Access</h2>
            <p className="muted">Purchase a license and return here to check status or reset HWID.</p>
          </div>
          <a href={purchaseUrl} target="_blank" rel="noreferrer">Buy License</a>
        </section>
      )}
    </main>
  );
}

function InfoCard({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <article className="info-card">
      <span>{label}</span>
      <strong className={danger ? "danger" : ""}>{value}</strong>
    </article>
  );
}

function Status({ state }: { state: ApiState }) {
  if (!state.message) return null;
  return <p className={`status ${state.ok === false ? "bad" : state.ok ? "good" : ""}`}>{state.message}</p>;
}

createRoot(document.getElementById("root")!).render(<App />);
