import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const fallbackAvatar = "https://i.pinimg.com/736x/0d/ad/95/0dad951463f4f4f97294a7a976946b64.jpg";
const purchaseUrl = "https://www.pedri.lol/";

type Tab = "profile" | "settings" | "download" | "purchase";

type DiscordProfile = {
  id: string;
  username: string;
  name: string;
  avatar: string;
};

type LicenseInfo = {
  key?: string;
  status?: string;
  username?: string;
  level?: number | string;
  expires?: number | null;
  days?: number | null;
  authToken?: string;
};

type Session = {
  discord: DiscordProfile;
  license?: LicenseInfo | null;
};

type ApiState = {
  loading: boolean;
  message: string;
  ok: boolean | null;
};

async function readApiJson(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`API returned ${response.status}: ${text.slice(0, 120) || response.statusText}`);
  }
}

function App() {
  const [tab, setTab] = useState<Tab>("profile");
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [license, setLicense] = useState("");
  const [redeemState, setRedeemState] = useState<ApiState>({ loading: false, message: "", ok: null });
  const [resetState, setResetState] = useState<ApiState>({ loading: false, message: "", ok: null });

  useEffect(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) return null;
        return readApiJson(response);
      })
      .then((data) => {
        if (data?.success) setSession(data.session);
      })
      .finally(() => setLoadingSession(false));
  }, []);

  const licenseInfo = session?.license || null;
  const licenseStatus = useMemo(() => {
    if (!licenseInfo) return "NO LICENSE";
    return String(licenseInfo.status || "ACTIVE").toUpperCase();
  }, [licenseInfo]);

  const rank = licenseStatus === "ACTIVE" ? "PREMIUM" : "USER";
  const daysText = licenseInfo?.days === null || licenseInfo?.days === undefined
    ? "Lifetime / Unknown"
    : `${licenseInfo.days} days left`;

  async function redeemLicense() {
    setRedeemState({ loading: true, message: "Linking license...", ok: null });

    try {
      const response = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license })
      });
      const data = await readApiJson(response);
      setRedeemState({ loading: false, message: data.message || "Done", ok: Boolean(data.success) });
      if (data.success && session) {
        setSession({ ...session, license: data.license });
        setLicense("");
      }
    } catch (error) {
      setRedeemState({
        loading: false,
        message: error instanceof Error ? error.message : "Could not contact the API.",
        ok: false
      });
    }
  }

  async function resetHwid() {
    setResetState({ loading: true, message: "Resetting HWID...", ok: null });

    try {
      const response = await fetch("/api/reset-hwid", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await readApiJson(response);
      setResetState({ loading: false, message: data.message || "Done", ok: Boolean(data.success) });
    } catch (error) {
      setResetState({
        loading: false,
        message: error instanceof Error ? error.message : "Could not contact the API.",
        ok: false
      });
    }
  }

  if (loadingSession) {
    return <main className="login-page"><div className="login-card"><div className="loader" /></div></main>;
  }

  if (!session) {
    return <LoginPage />;
  }

  const avatar = session.discord.avatar || fallbackAvatar;

  return (
    <main className="page-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <nav className="top-nav" aria-label="Main navigation">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>Settings</button>
        <button className={tab === "download" ? "active" : ""} onClick={() => setTab("download")}>Download</button>
        <button className={tab === "purchase" ? "active" : ""} onClick={() => setTab("purchase")}>Purchase</button>
        <a href="/api/logout">Logout</a>
      </nav>

      <section className="hero-card">
        <div className="hero-media" />
        <div className="hero-overlay" />
        <img className="avatar" src={avatar} alt="Profile avatar" />
        <div className="hero-copy">
          {licenseStatus !== "ACTIVE" && <span className="expired-dot">No active license</span>}
          <h1>/{session.discord.name}'s</h1>
        </div>
      </section>

      {tab === "profile" && (
        <section className="grid profile-grid">
          <InfoCard label="Discord ID" value={session.discord.id} />
          <InfoCard label="Rank" value={rank} premium={rank === "PREMIUM"} />
          <InfoCard label="License" value={licenseStatus} subValue={licenseInfo ? daysText : "Redeem a key"} danger={licenseStatus !== "ACTIVE"} />
        </section>
      )}

      {tab === "settings" && (
        <section className="grid settings-grid">
          <div className="panel">
            <h2>Redeem License</h2>
            <p className="muted">Your key will be linked to this Discord account.</p>
            <input value={license} onChange={(event) => setLicense(event.target.value)} placeholder="blaze-xxxx-xxxx-xxxx" />
            <button onClick={redeemLicense} disabled={redeemState.loading}>{redeemState.loading ? "Linking..." : "Redeem License"}</button>
            <Status state={redeemState} />
          </div>

          <div className="panel">
            <h2>HWID Reset</h2>
            <p className="muted">Reset the PC lock for the license linked to your Discord account.</p>
            <button onClick={resetHwid} disabled={resetState.loading || !licenseInfo}>{resetState.loading ? "Resetting..." : "Reset HWID"}</button>
            <Status state={resetState} />
          </div>
        </section>
      )}

      {tab === "download" && (
        <section className="download-panel">
          <div>
            <span className="eyebrow">Blaza PVP</span>
            <h2>Download Config</h2>
            <p className="muted">
              This file links your app to the Discord account that redeemed the license.
            </p>
          </div>
          <div className="download-actions">
            <a className={!licenseInfo ? "disabled" : ""} href={licenseInfo ? "/api/download-config" : undefined}>Download License Config</a>
            <small>{licenseInfo ? "Use this file with the app login system." : "Redeem a license first."}</small>
          </div>
        </section>
      )}

      {tab === "purchase" && (
        <section className="purchase-panel">
          <div>
            <span className="eyebrow">Blaza PVP</span>
            <h2>Get Access</h2>
            <p className="muted">Buy a license, log in with Discord, and redeem it here.</p>
          </div>
          <a href={purchaseUrl} target="_blank" rel="noreferrer">Buy License</a>
        </section>
      )}
    </main>
  );
}

function LoginPage() {
  const error = new URLSearchParams(window.location.search).get("auth_error");

  return (
    <main className="login-page">
      <div className="login-bg" />
      <section className="login-card">
        <div className="brand-mark">B</div>
        <h1>Sign in to <span>Blaza</span></h1>
        <p>Access your dashboard to manage your license, reset HWID, and view premium status.</p>
        <a className="discord-button" href="/api/discord-login">Login with Discord</a>
        <div className="secure-row"><span />Secure Authentication<span /></div>
        <p className="fine-print">No password required. Discord OAuth2 only.</p>
        {error && <p className="status bad">{error}</p>}
      </section>
    </main>
  );
}

function InfoCard({ label, value, subValue, danger = false, premium = false }: { label: string; value: string; subValue?: string; danger?: boolean; premium?: boolean }) {
  return (
    <article className="info-card">
      <span>{label}</span>
      <strong className={danger ? "danger" : premium ? "premium" : ""}>{value}</strong>
      {subValue && <em>{subValue}</em>}
    </article>
  );
}

function Status({ state }: { state: ApiState }) {
  if (!state.message) return null;
  return <p className={`status ${state.ok === false ? "bad" : state.ok ? "good" : ""}`}>{state.message}</p>;
}

createRoot(document.getElementById("root")!).render(<App />);
